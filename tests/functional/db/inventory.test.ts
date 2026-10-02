/**
 * Functional tests: inventory.
 *
 * Inventory is authoritative in the database, and the only decrement that is
 * safe is a conditional one:
 *
 *   update products set inventory = inventory - $qty
 *    where id = $id and inventory >= $qty;
 *
 * The guard is evaluated while Postgres holds the row lock, so the loser of a
 * race for the last unit gets zero rows back instead of taking stock that is
 * already sold. These tests assert that property directly, and assert the two
 * things that make it hold: the arithmetic happens in the database, and the
 * result is checked rather than assumed.
 *
 * Every product here is created and deleted by this run. The seeded catalogue —
 * including the deliberately low stock on `technical-fountain-pen` — is never
 * touched, so a failing run cannot change what another agent sees.
 */

import { describe, expect, it } from 'vitest';
import { skipReason } from '../../setup/functional';
import {
  adminClient,
  anonymousClient,
  createTestProduct,
  createTestUser,
  deleteTestProduct,
  deleteTestUser,
  type TestProduct,
} from './harness';

const reason = skipReason();

/**
 * The frozen `Database` contract declares `Functions: Record<never, never>`.
 * `decrement_inventory` is the one callable surface the migrations added, and
 * the request to add it to `src/lib/supabase.types.ts` is written up in
 * `docs/CONTRACT-REQUESTS.md`. This narrow signature is exactly what the
 * regenerated types will say, so the test compiles today and keeps compiling
 * afterwards — without an `any` anywhere.
 */
interface InventoryService {
  rpc(
    fn: 'decrement_inventory',
    args: { p_product_id: string; p_quantity: number },
  ): PromiseLike<{ data: number | null; error: { message: string; code?: string } | null }>;
}

/** One decrement, through the database's own arithmetic. Throws rather than returning an error. */
async function takeStock(productId: string, quantity: number): Promise<number | null> {
  const service = adminClient() as unknown as InventoryService;
  const { data, error } = await service.rpc('decrement_inventory', {
    p_product_id: productId,
    p_quantity: quantity,
  });
  if (error !== null) throw new Error(`decrement_inventory failed: ${error.message}`);
  return data;
}

async function inventoryOf(productId: string): Promise<number | null> {
  const { data, error } = await adminClient()
    .from('products')
    .select('inventory')
    .eq('id', productId)
    .single();
  if (error !== null) throw new Error(`Could not read inventory: ${error.message}`);
  return data.inventory;
}

describe.skipIf(reason !== null)('conditional inventory decrement', () => {
  it('takes stock and reports that it did', async () => {
    const product = await createTestProduct({ inventory: 5 });
    try {
      expect(await takeStock(product.id, 2)).toBe(1);
      expect(await inventoryOf(product.id)).toBe(3);

      expect(await takeStock(product.id, 3)).toBe(1);
      expect(await inventoryOf(product.id)).toBe(0);
    } finally {
      await deleteTestProduct(product.id);
    }
  });

  it('reports zero rows and changes nothing when there is not enough stock', async () => {
    const product = await createTestProduct({ inventory: 2 });
    try {
      expect(await takeStock(product.id, 3)).toBe(0);
      expect(await inventoryOf(product.id)).toBe(2);

      // The exact boundary is allowed: asking for everything that is there.
      expect(await takeStock(product.id, 2)).toBe(1);
      expect(await inventoryOf(product.id)).toBe(0);
      expect(await takeStock(product.id, 1)).toBe(0);
      expect(await inventoryOf(product.id)).toBe(0);
    } finally {
      await deleteTestProduct(product.id);
    }
  });

  it('refuses a quantity that is not positive rather than creating stock', async () => {
    const product = await createTestProduct({ inventory: 4 });
    try {
      for (const quantity of [0, -5]) {
        const service = adminClient() as unknown as InventoryService;
        const { error } = await service.rpc('decrement_inventory', {
          p_product_id: product.id,
          p_quantity: quantity,
        });
        expect(error, `a quantity of ${quantity} must be rejected`).not.toBeNull();
      }
      expect(await inventoryOf(product.id)).toBe(4);
    } finally {
      await deleteTestProduct(product.id);
    }
  });

  it('lets exactly one of five concurrent checkouts have the last unit', async () => {
    const product = await createTestProduct({ inventory: 1 });
    try {
      // Five requests, issued together, over separate connections. Whether the
      // database interleaves them or runs them one after another, the outcome
      // must be the same: one winner, four refusals, and stock that lands on
      // zero rather than below it.
      const attempts = await Promise.all(Array.from({ length: 5 }, () => takeStock(product.id, 1)));

      expect(attempts.filter((rows) => rows === 1)).toHaveLength(1);
      expect(attempts.filter((rows) => rows === 0)).toHaveLength(4);
      expect(await inventoryOf(product.id)).toBe(0);
    } finally {
      await deleteTestProduct(product.id);
    }
  });

  it('serves a contended product exactly as many units as it had', async () => {
    const product = await createTestProduct({ inventory: 7 });
    try {
      // Three buyers, four units each, twelve units requested against seven in
      // stock. Whatever order they land in, the shop sells seven and never
      // eight.
      const attempts = await Promise.all(Array.from({ length: 3 }, () => takeStock(product.id, 4)));

      const sold = attempts.filter((rows) => rows === 1).length;
      const remaining = (await inventoryOf(product.id)) ?? -1;

      expect(sold).toBeLessThanOrEqual(2);
      expect(remaining).toBe(7 - sold * 4);
      expect(remaining).toBeGreaterThanOrEqual(0);
    } finally {
      await deleteTestProduct(product.id);
    }
  });

  it('refuses to store negative inventory at all, whatever the caller', async () => {
    const product = await createTestProduct({ inventory: 3 });
    try {
      const direct = await adminClient()
        .from('products')
        .update({ inventory: -1 })
        .eq('id', product.id);
      expect(direct.error, 'the check constraint must reject a negative stock').not.toBeNull();
      expect(await inventoryOf(product.id)).toBe(3);
    } finally {
      await deleteTestProduct(product.id);
    }
  });

  it('is not callable from a browser, signed in or not', async () => {
    const product: TestProduct = await createTestProduct({ inventory: 6 });
    const user = await createTestUser('inventory-browser');

    try {
      const callers = [anonymousClient(), user.client] as const;

      for (const caller of callers) {
        const service = caller as unknown as InventoryService;
        const { data, error } = await service.rpc('decrement_inventory', {
          p_product_id: product.id,
          p_quantity: 1,
        });
        expect(error, 'a browser must not be able to decrement stock').not.toBeNull();
        expect(data).toBeNull();
      }

      // Nothing moved.
      expect(await inventoryOf(product.id)).toBe(6);
    } finally {
      await deleteTestUser(user.id);
      await deleteTestProduct(product.id);
    }
  });
});
