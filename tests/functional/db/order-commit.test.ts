/**
 * Functional tests: `create_order_atomic`.
 *
 * This is the only mutating path into `orders`, and the reason the V1 write path
 * cannot be expressed as "some RLS-protected inserts": SPEC §Edge Functions
 * requires the order, its items, the cart closure and the stock decrement to
 * happen as one transaction, and PostgREST runs one statement per request.
 *
 * Two things are asserted here, and the first is what makes the second mean
 * anything:
 *
 *   1. The service role can reach the function, and gets a real structured
 *      outcome out of it. Without this, "the browser call errored" would also be
 *      true on a database where the function had never been created.
 *   2. `anon` and `authenticated` cannot. The error is pinned to `42501`
 *      (`insufficient_privilege`) specifically, so restoring the grant fails the
 *      test, and *deleting* the function fails it too — that one would come back
 *      as `PGRST202`, "not found".
 *
 * Every product and every user here is created and deleted by this run. The
 * seeded catalogue is never touched.
 */

import { describe, expect, it } from 'vitest';
import {
  adminClient,
  anonymousClient,
  createTestProduct,
  createTestUser,
  deleteTestProduct,
  deleteTestUser,
  seedActiveCart,
  seedCartItem,
  type TestProduct,
  type TestUser,
} from './harness';

const SHIPPING: Record<string, string> = {
  fullName: 'Kanso Checkout Fixture',
  email: 'kanso-checkout@example.com',
  phone: '+2348030000000',
  addressLine1: '1 Test Street',
  addressLine2: '',
  city: 'Lagos',
  state: 'Lagos',
  country: 'Nigeria',
};

interface CommitOutcome {
  ok: boolean;
  code?: string;
  order?: { id: string; reference: string; total_kobo: number };
  items?: { product_id: string; product_name: string; quantity: number; unit_price_kobo: number }[];
  productName?: string;
  requested?: number;
  available?: number;
}

/** Commit as the service role, which is the only role the SQL grants this to. */
async function commit(userId: string, cartId: string): Promise<CommitOutcome | null> {
  const { data, error } = await adminClient().rpc('create_order_atomic', {
    p_user_id: userId,
    p_cart_id: cartId,
    p_shipping: SHIPPING,
  });
  if (error !== null) return null;
  return data as unknown as CommitOutcome;
}

async function countOrders(userId: string): Promise<number> {
  const { count, error } = await adminClient()
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  if (error !== null) throw new Error(`Could not count orders: ${error.message}`);
  return count ?? 0;
}

async function inventoryOf(productId: string): Promise<number> {
  const { data, error } = await adminClient()
    .from('products')
    .select('inventory')
    .eq('id', productId)
    .single();
  if (error !== null) throw new Error(`Could not read inventory: ${error.message}`);
  return data.inventory;
}

async function cartStatus(cartId: string): Promise<{ status: string; closed_at: string | null }> {
  const { data, error } = await adminClient()
    .from('carts')
    .select('status, closed_at')
    .eq('id', cartId)
    .single();
  if (error !== null) throw new Error(`Could not read the cart: ${error.message}`);
  return data;
}

/** A user with an active cart holding one line, ready to check out. */
async function customerWithCart(
  label: string,
  product: TestProduct,
  quantity: number,
): Promise<{ user: TestUser; cartId: string }> {
  const user = await createTestUser(label);
  const cartId = await seedActiveCart(user.id);
  await seedCartItem(cartId, product.id, quantity);
  return { user, cartId };
}

describe('create_order_atomic is a server-side function', () => {
  it('is callable by the service role, which is what makes the refusal below meaningful', async () => {
    const product = await createTestProduct({ price_kobo: 120_000, inventory: 5 });
    const { user, cartId } = await customerWithCart('commit-allowed', product, 2);

    try {
      const outcome = await commit(user.id, cartId);

      expect(outcome).not.toBeNull();
      expect(outcome?.ok).toBe(true);
      expect(outcome?.order?.total_kobo).toBe(240_000);
    } finally {
      await deleteTestUser(user.id);
      await deleteTestProduct(product.id);
    }
  });

  it('cannot be called by a signed-in browser, and the refusal is a privilege error', async () => {
    const product = await createTestProduct({ price_kobo: 120_000, inventory: 5 });
    const { user, cartId } = await customerWithCart('commit-denied', product, 1);

    try {
      const callers = [anonymousClient(), user.client] as const;

      for (const caller of callers) {
        const { data, error } = await caller.rpc('create_order_atomic', {
          p_user_id: user.id,
          p_cart_id: cartId,
          p_shipping: SHIPPING,
        });

        // `42501` is `insufficient_privilege`. `PGRST202` would mean the
        // function is gone rather than protected, and success would mean the
        // grant came back — both are failures here, deliberately distinguished.
        expect(error, 'a browser must not be able to place an order directly').not.toBeNull();
        expect(error?.code).toBe('42501');
        expect(data).toBeNull();
      }

      // Nothing happened: no order, no closed cart, no stock taken.
      expect(await countOrders(user.id)).toBe(0);
      expect((await cartStatus(cartId)).status).toBe('active');
      expect(await inventoryOf(product.id)).toBe(5);
    } finally {
      await deleteTestUser(user.id);
      await deleteTestProduct(product.id);
    }
  });
});

describe('create_order_atomic commits or leaves nothing behind', () => {
  it('writes the order, the items, closes the cart and takes the stock', async () => {
    const product = await createTestProduct({
      name: 'Commit Fixture',
      price_kobo: 450_000,
      inventory: 10,
    });
    const { user, cartId } = await customerWithCart('commit-happy', product, 2);

    try {
      const outcome = await commit(user.id, cartId);

      expect(outcome?.ok).toBe(true);
      expect(outcome?.order?.reference).toMatch(/^KS-[0-9A-F]{4}-[0-9A-F]{2}$/);
      expect(outcome?.order?.total_kobo).toBe(900_000);
      expect(outcome?.items).toHaveLength(1);
      expect(outcome?.items?.[0]?.product_id).toBe(product.id);
      expect(outcome?.items?.[0]?.unit_price_kobo).toBe(450_000);

      const items = await adminClient()
        .from('order_items')
        .select('product_name, quantity, unit_price_kobo')
        .eq('order_id', outcome?.order?.id ?? '');
      expect(items.error).toBeNull();
      expect(items.data).toHaveLength(1);
      expect(items.data?.[0]).toMatchObject({
        product_name: 'Commit Fixture',
        quantity: 2,
        unit_price_kobo: 450_000,
      });

      expect(await cartStatus(cartId)).toMatchObject({ status: 'closed' });
      expect((await cartStatus(cartId)).closed_at).not.toBeNull();
      expect(await inventoryOf(product.id)).toBe(8);
    } finally {
      await deleteTestUser(user.id);
      await deleteTestProduct(product.id);
    }
  });

  it('refuses a second commit of the same cart', async () => {
    const product = await createTestProduct({ price_kobo: 100_000, inventory: 10 });
    const { user, cartId } = await customerWithCart('commit-twice', product, 1);

    try {
      expect((await commit(user.id, cartId))?.ok).toBe(true);

      expect(await commit(user.id, cartId)).toEqual({ ok: false, code: 'cart_not_active' });
      expect(await countOrders(user.id)).toBe(1);
      expect(await inventoryOf(product.id)).toBe(9);
    } finally {
      await deleteTestUser(user.id);
      await deleteTestProduct(product.id);
    }
  });

  it("refuses another user's cart", async () => {
    const product = await createTestProduct({ price_kobo: 100_000, inventory: 10 });
    const owner = await customerWithCart('commit-owner', product, 1);
    const stranger = await createTestUser('commit-stranger');

    try {
      expect(await commit(stranger.id, owner.cartId)).toEqual({
        ok: false,
        code: 'cart_not_active',
      });
      expect(await countOrders(owner.user.id)).toBe(0);
      expect((await cartStatus(owner.cartId)).status).toBe('active');
      expect(await inventoryOf(product.id)).toBe(10);
    } finally {
      await deleteTestUser(owner.user.id);
      await deleteTestUser(stranger.id);
      await deleteTestProduct(product.id);
    }
  });

  it('names the product and the available count when stock is short, and writes nothing', async () => {
    const product = await createTestProduct({
      name: 'Short Fixture',
      price_kobo: 100_000,
      inventory: 1,
    });
    const { user, cartId } = await customerWithCart('commit-short', product, 9);

    try {
      expect(await commit(user.id, cartId)).toMatchObject({
        ok: false,
        code: 'insufficient_inventory',
        productName: 'Short Fixture',
        requested: 9,
        available: 1,
      });

      expect(await countOrders(user.id)).toBe(0);
      expect((await cartStatus(cartId)).status).toBe('active');
      expect(await inventoryOf(product.id)).toBe(1);
    } finally {
      await deleteTestUser(user.id);
      await deleteTestProduct(product.id);
    }
  });

  it('prices from the catalogue, so repricing afterwards leaves the order alone', async () => {
    const product = await createTestProduct({ price_kobo: 400_000, inventory: 10 });
    const { user, cartId } = await customerWithCart('commit-reprice', product, 1);

    try {
      const outcome = await commit(user.id, cartId);
      expect(outcome?.order?.total_kobo).toBe(400_000);

      const { error } = await adminClient()
        .from('products')
        .update({ price_kobo: 999_000 })
        .eq('id', product.id);
      expect(error).toBeNull();

      const { data: stored, error: readError } = await adminClient()
        .from('orders')
        .select('total_kobo')
        .eq('id', outcome?.order?.id ?? '')
        .single();
      expect(readError).toBeNull();
      expect(stored?.total_kobo).toBe(400_000);
    } finally {
      await deleteTestUser(user.id);
      await deleteTestProduct(product.id);
    }
  });
});
