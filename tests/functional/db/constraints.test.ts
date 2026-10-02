/**
 * Functional tests: the constraints that make the domain rules true.
 *
 * Zod validates the browser's copy of these rules and is the first line of
 * defence. This file is the second: a client that skips validation, or a future
 * Edge Function that gets a rule wrong, must hit a database error rather than
 * corrupt a cart or rewrite history.
 *
 * Everything here runs as a real signed-in user wherever the browser is
 * supposed to be able to do the thing, so the RLS policy and the constraint are
 * exercised together. The fixtures that mutate a price or a stock level are
 * products this run creates and deletes again — the shared catalogue is never
 * touched.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminClient,
  createTestProduct,
  createTestUser,
  deleteTestProduct,
  deleteTestUser,
  seedActiveCart,
  seedOrder,
  seedOrderItem,
  type TestProduct,
  type TestUser,
} from './harness';

/** A brief, readable failure beats a bare PostgREST message. */
function expectError(error: { code?: string } | null, sqlState: string, what: string): void {
  expect(error, `${what} should have been refused`).not.toBeNull();
  expect(error?.code, `${what} should have failed with ${sqlState}`).toBe(sqlState);
}

describe('cart and order constraints', () => {
  let user: TestUser;
  let product: TestProduct;
  let cart: string;

  beforeAll(async () => {
    user = await createTestUser('constraints');
    product = await createTestProduct({ name: 'Constraint Fixture', inventory: 50 });
    // The user's first cart, created by the user, exactly as `useCart` does.
    cart = await seedActiveCart(user.id);
  });

  afterAll(async () => {
    await deleteTestUser(user.id);
    await deleteTestProduct(product.id);
  });

  it('allows one active cart per user, and as many closed ones as they like', async () => {
    const second = await user.client
      .from('carts')
      .insert({ user_id: user.id, status: 'active' })
      .select('id');
    expectError(second.error, '23505', 'a second active cart');

    // Closing the first one frees the slot, which is what makes the constraint
    // "at most one *active*" rather than "at most one cart, ever".
    const closed = await user.client
      .from('carts')
      .update({ status: 'closed', closed_at: new Date().toISOString() })
      .eq('id', cart);
    expect(closed.error).toBeNull();
    const replacement = await user.client
      .from('carts')
      .insert({ user_id: user.id, status: 'active' })
      .select('id')
      .single();
    expect(replacement.error).toBeNull();
    const replacementId = replacement.data?.id;
    expect(typeof replacementId).toBe('string');
    cart = replacementId ?? cart;

    const all = await user.client.from('carts').select('id, status');
    expect(all.data).toHaveLength(2);
    expect(all.data?.filter((row) => row.status === 'active')).toHaveLength(1);
  });

  it('refuses the same product twice in one cart, and updates the line instead', async () => {
    const first = await user.client
      .from('cart_items')
      .insert({ cart_id: cart, product_id: product.id, quantity: 1 })
      .select('id')
      .single();
    expect(first.error).toBeNull();

    const duplicate = await user.client
      .from('cart_items')
      .insert({ cart_id: cart, product_id: product.id, quantity: 2 });
    expectError(duplicate.error, '23505', 'a duplicate product in one cart');

    // The path `useCart` actually takes when the quantity changes.
    const updated = await user.client
      .from('cart_items')
      .upsert(
        { cart_id: cart, product_id: product.id, quantity: 4 },
        { onConflict: 'cart_id,product_id' },
      )
      .select('*')
      .single();
    expect(updated.error).toBeNull();
    expect(updated.data?.id).toBe(first.data?.id);
    expect(updated.data?.quantity).toBe(4);

    const lines = await user.client.from('cart_items').select('*').eq('cart_id', cart);
    expect(lines.data).toHaveLength(1);
  });

  it('refuses a cart quantity that is not positive', async () => {
    for (const quantity of [0, -1]) {
      const result = await user.client
        .from('cart_items')
        .update({ quantity })
        .eq('cart_id', cart)
        .eq('product_id', product.id);
      expectError(result.error, '23514', `a quantity of ${quantity}`);
    }

    // The check runs on the row that was already there, so the attempt to set
    // zero changed nothing — which is why `setItemQuantity(p, 0)` has to delete
    // the line rather than update it to zero.
    const line = await user.client
      .from('cart_items')
      .select('quantity')
      .eq('cart_id', cart)
      .single();
    expect(line.data?.quantity).toBe(4);

    const removed = await user.client
      .from('cart_items')
      .delete()
      .eq('cart_id', cart)
      .eq('product_id', product.id);
    expect(removed.error).toBeNull();
  });

  it('gives every order a generated reference', async () => {
    const order = await adminClient()
      .from('orders')
      .insert({
        user_id: user.id,
        status: 'confirmed',
        email: user.email,
        phone: '+2348030000000',
        full_name: 'Reference Fixture',
        address_line1: '1 Test Street',
        address_line2: null,
        city: 'Lagos',
        state: 'Lagos',
        country: 'Nigeria',
        subtotal_kobo: 0,
        total_kobo: 0,
      })
      .select('reference')
      .single();

    expect(order.error).toBeNull();
    expect(order.data?.reference).toMatch(/^KS-[0-9A-F]{4}-[0-9A-F]{2}$/);
  });
});

describe('the order snapshot', () => {
  it('keeps the price the customer was charged after the catalogue is repriced', async () => {
    const product = await createTestProduct({ name: 'Snapshot Fixture', price_kobo: 400_000 });
    const user = await createTestUser('snapshot');

    try {
      const orderId = await seedOrder(user.id, { subtotal_kobo: 800_000, total_kobo: 800_000 });
      const itemId = await seedOrderItem(orderId, product, 2, 400_000);

      // Reprice the catalogue. A historical order must not notice.
      const repriced = await adminClient()
        .from('products')
        .update({ price_kobo: 999_000 })
        .eq('id', product.id);
      expect(repriced.error).toBeNull();

      const stored = await adminClient().from('order_items').select('*').eq('id', itemId).single();
      expect(stored.data?.unit_price_kobo).toBe(400_000);
      expect(stored.data?.product_name).toBe(product.name);
      expect(stored.data?.quantity).toBe(2);

      // The line total is 2 x 400000, not 2 x 999000.
      expect((stored.data?.quantity ?? 0) * (stored.data?.unit_price_kobo ?? 0)).toBe(800_000);

      // The current catalogue price is the new one, so nothing was rewritten.
      const current = await adminClient()
        .from('products')
        .select('price_kobo')
        .eq('id', product.id)
        .single();
      expect(current.data?.price_kobo).toBe(999_000);
    } finally {
      await deleteTestUser(user.id);
      await deleteTestProduct(product.id);
    }
  });
});
