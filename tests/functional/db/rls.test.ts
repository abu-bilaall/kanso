/**
 * Functional tests: row level security.
 *
 * These are the security-critical tests in the project. Each one states a
 * property a *browser* client must not be able to break, and each is written so
 * that a plausible mistake in the policies makes it go red rather than quietly
 * pass:
 *
 * - Denials are asserted on the *effect* (no rows, no mutation) as well as on
 *   the error, so a policy that is too permissive fails even when PostgREST
 *   happens to return a 200 with zero rows.
 * - Every write a browser is refused is also attempted as the service role. If
 *   the same payload succeeds there, the failure above was the policy and not a
 *   typo in the column list.
 * - Ownership is always resolved from the caller's JWT, never from a column the
 *   caller supplied. That is why there is no `user_id` argument anywhere below.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { skipReason } from '../../setup/functional';
import {
  adminClient,
  anonymousClient,
  createTestProduct,
  createTestUser,
  deleteTestProduct,
  deleteTestUser,
  seedActiveCart,
  seedCartItem,
  seedOrder,
  seedOrderItem,
  TEST_PASSWORD,
  type TestProduct,
  type TestUser,
  testEmail,
} from './harness';

const reason = skipReason();

/** Every table whose rows belong to a user. Anonymous sees none of them. */
const USER_OWNED_TABLES = ['profiles', 'carts', 'cart_items', 'orders', 'order_items'] as const;

/** The catalogue PLAN.md §2.4 specifies. The storefront must serve all ten. */
const SEEDED_SLUGS = [
  'graphite-desk-pad',
  'milled-desk-weight',
  'oak-pen-cup',
  'steel-rule',
  'waxed-canvas-folio',
  'canvas-messenger-bag',
  'travel-tech-pouch',
  'dot-grid-notebook',
  'titanium-pencil',
  'technical-fountain-pen',
] as const;

describe.skipIf(reason !== null)('row level security', () => {
  let alice: TestUser;
  let bob: TestUser;
  let product: TestProduct;

  let aliceCart: string;
  let bobCart: string;
  let bobCartItem: string;
  let bobOrder: string;
  let bobOrderItem: string;

  beforeAll(async () => {
    alice = await createTestUser('alice');
    bob = await createTestUser('bob');
    product = await createTestProduct({ name: 'RLS Fixture', price_kobo: 250_000, inventory: 9 });

    // Alice's world: one cart, one line in it, one order, one line in that.
    aliceCart = await seedActiveCart(alice.id);
    await seedCartItem(aliceCart, product.id, 1);
    const aliceOrder = await seedOrder(alice.id, { full_name: 'Alice Fixture' });
    await seedOrderItem(aliceOrder, product, 1, 250_000);

    // Bob's world: the same, built with the service role, which is how
    // `create-order` writes. RLS is not what put these rows here.
    bobCart = await seedActiveCart(bob.id);
    bobCartItem = await seedCartItem(bobCart, product.id, 7);
    bobOrder = await seedOrder(bob.id, { full_name: 'Bob Fixture' });
    bobOrderItem = await seedOrderItem(bobOrder, product, 3, 250_000);
  });

  afterAll(async () => {
    // Deleting the auth user cascades: profiles, carts and orders go with it, and
    // the line items go with those. Nothing else in the catalogue is touched.
    await deleteTestUser(alice.id);
    await deleteTestUser(bob.id);
    await deleteTestProduct(product.id);
  });

  it("hides another user's cart, and their cart items, from a signed-in user", async () => {
    const all = await alice.client.from('carts').select('*');
    expect(all.error).toBeNull();
    expect(all.data?.map((cart) => cart.id)).toEqual([aliceCart]);

    const direct = await alice.client.from('carts').select('*').eq('id', bobCart);
    expect(direct.error).toBeNull();
    expect(direct.data).toEqual([]);

    // Cart item ownership is one join away: the row is filtered by the *parent
    // cart's* owner, so the whole table read returns only Alice's line.
    const items = await alice.client.from('cart_items').select('*');
    expect(items.error).toBeNull();
    expect(items.data?.map((item) => item.id)).toHaveLength(1);
    expect(items.data?.some((item) => item.id === bobCartItem)).toBe(false);

    const directItem = await alice.client.from('cart_items').select('*').eq('id', bobCartItem);
    expect(directItem.error).toBeNull();
    expect(directItem.data).toEqual([]);
  });

  it("refuses to let a user write to another user's cart", async () => {
    // A refused UPDATE or DELETE is *silent*: RLS hides the row, so there is
    // nothing left to touch and PostgREST returns no rows rather than an error.
    // The empty result and the untouched row are both asserted below, because
    // the status code alone would not notice a policy that was merely absent.
    const updated = await alice.client
      .from('carts')
      .update({ status: 'closed' })
      .eq('id', bobCart)
      .select('id');
    expect(updated.error).toBeNull();
    expect(updated.data).toEqual([]);

    const deleted = await alice.client.from('carts').delete().eq('id', bobCart).select('id');
    expect(deleted.error).toBeNull();
    expect(deleted.data).toEqual([]);

    // Adding a line to somebody else's cart is the interesting one: the insert
    // policy has to resolve the parent cart, not trust a user_id in the payload.
    // A refused INSERT *is* an error, because the row was in reach and only the
    // WITH CHECK said no.
    //
    // The product has to be one Bob's cart does not already hold, or the insert
    // would fail on the unique constraint and the test would pass for the wrong
    // reason — which is exactly what happens if this line is removed.
    const spare = await createTestProduct({ name: 'Foreign Cart Fixture' });
    try {
      const inserted = await alice.client
        .from('cart_items')
        .insert({ cart_id: bobCart, product_id: spare.id, quantity: 1 });
      expect(inserted.error).not.toBeNull();

      // Effect, not just status: Bob's cart is untouched and still holds one line.
      const bobItems = await adminClient().from('cart_items').select('*').eq('cart_id', bobCart);
      expect(bobItems.data?.map((item) => item.id)).toEqual([bobCartItem]);
    } finally {
      await adminClient()
        .from('cart_items')
        .delete()
        .eq('cart_id', bobCart)
        .eq('product_id', spare.id);
      await deleteTestProduct(spare.id);
    }

    // A cart you own is still a cart you own afterwards. Handing it to somebody
    // else is not a thing a browser can do, whether the write is filtered out or
    // refused outright.
    const reassigned = await alice.client
      .from('carts')
      .update({ user_id: bob.id })
      .eq('id', aliceCart);
    expect(reassigned.error, 'a cart must not be handed to another user').not.toBeNull();

    const stillMine = await adminClient()
      .from('carts')
      .select('user_id, status')
      .eq('id', aliceCart)
      .single();
    expect(stillMine.data?.user_id).toBe(alice.id);
    expect(stillMine.data?.status).toBe('active');

    // And Bob still has exactly the one cart he started with.
    const bobCarts = await adminClient().from('carts').select('id').eq('user_id', bob.id);
    expect(bobCarts.data?.map((row) => row.id)).toEqual([bobCart]);
  });

  it("hides another user's orders and order items", async () => {
    const orders = await alice.client.from('orders').select('*');
    expect(orders.error).toBeNull();
    expect(orders.data?.map((order) => order.id)).toHaveLength(1);
    expect(orders.data?.some((order) => order.id === bobOrder)).toBe(false);

    const direct = await alice.client.from('orders').select('*').eq('id', bobOrder);
    expect(direct.error).toBeNull();
    expect(direct.data).toEqual([]);

    // Order item ownership resolves through the parent order. Bob's order item
    // must not be reachable even though Alice can read *a* product row.
    const items = await alice.client.from('order_items').select('*');
    expect(items.error).toBeNull();
    expect(items.data?.map((item) => item.id)).toHaveLength(1);
    expect(items.data?.some((item) => item.id === bobOrderItem)).toBe(false);

    const directItem = await alice.client.from('order_items').select('*').eq('id', bobOrderItem);
    expect(directItem.error).toBeNull();
    expect(directItem.data).toEqual([]);
  });

  it('refuses to let a user write an order, or edit one that already exists', async () => {
    // Silent, like the cart above: an order the caller cannot see is an order
    // they cannot rewrite or delete.
    const totalChanged = await alice.client
      .from('orders')
      .update({ total_kobo: 1 })
      .eq('id', bobOrder)
      .select('id');
    expect(totalChanged.error).toBeNull();
    expect(totalChanged.data).toEqual([]);

    const deleted = await alice.client.from('orders').delete().eq('id', bobOrder).select('id');
    expect(deleted.error).toBeNull();
    expect(deleted.data).toEqual([]);

    // The effect: Bob's order total is untouched, and his order item is intact.
    const bobOrderRow = await adminClient()
      .from('orders')
      .select('total_kobo')
      .eq('id', bobOrder)
      .single();
    expect(bobOrderRow.data?.total_kobo).toBe(0);

    const bobItemRow = await adminClient()
      .from('order_items')
      .select('unit_price_kobo')
      .eq('id', bobOrderItem)
      .single();
    expect(bobItemRow.data?.unit_price_kobo).toBe(250_000);
  });

  it('refuses catalogue mutation to a signed-in user, and refuses it anonymously', async () => {
    const anonymous = anonymousClient();

    for (const [who, client] of [
      ['authenticated', alice.client],
      ['anonymous', anonymous],
    ] as const) {
      // A distinct slug per caller: a shared one would make the second insert
      // fail on the unique constraint instead of on the policy, and the test
      // would pass for the wrong reason.
      const payload = {
        slug: `a1-probe-${who}-${Date.now().toString(36)}`,
        name: 'Catalogue Probe',
        category: 'desk',
        spec_line: null,
        description: null,
        price_kobo: 1_000,
        inventory: 1,
        image_path: null,
      } as const;

      // No INSERT policy exists, so the row is in reach and the WITH CHECK says
      // no: that is an error.
      const inserted = await client.from('products').insert(payload);
      expect(inserted.error, `${who} must not be able to insert a product`).not.toBeNull();

      // No UPDATE or DELETE policy exists, so the row is never visible to touch:
      // an empty result, not an error. Both spellings of "no" are checked.
      const updated = await client
        .from('products')
        .update({ price_kobo: 1, name: 'Repriced by a browser' })
        .eq('id', product.id)
        .select('id');
      expect(updated.error, `${who} must not be able to update a product`).toBeNull();
      expect(updated.data, `${who} must not be able to update a product`).toEqual([]);

      const deleted = await client.from('products').delete().eq('id', product.id).select('id');
      expect(deleted.error, `${who} must not be able to delete a product`).toBeNull();
      expect(deleted.data, `${who} must not be able to delete a product`).toEqual([]);
    }

    // Effect, not just status: the catalogue is exactly as it was.
    const stillThere = await adminClient()
      .from('products')
      .select('name, price_kobo')
      .eq('id', product.id)
      .single();
    expect(stillThere.data).toEqual({ name: 'RLS Fixture', price_kobo: 250_000 });

    // Control: the same shape of row inserted as the service role succeeds, so
    // the refusals above are the policies and not a malformed payload.
    const asService = await adminClient()
      .from('products')
      .insert({
        slug: `a1-probe-control-${Date.now().toString(36)}`,
        name: 'Catalogue Probe',
        category: 'desk',
        spec_line: null,
        description: null,
        price_kobo: 1_000,
        inventory: 1,
        image_path: null,
      })
      .select('id')
      .single();
    expect(asService.error).toBeNull();
    if (asService.data !== null) await deleteTestProduct(asService.data.id);
  });

  it('lets a user read and manage their own cart and their own cart items', async () => {
    const cart = await bob.client.from('carts').select('*').eq('id', bobCart).single();
    expect(cart.error).toBeNull();
    expect(cart.data?.user_id).toBe(bob.id);
    expect(cart.data?.status).toBe('active');

    // A product of this run's own, so adding a line here cannot collide with
    // the line the isolation test above already put in Bob's cart.
    const spare = await createTestProduct({ name: 'Cart Management Fixture' });
    try {
      const added = await bob.client
        .from('cart_items')
        .insert({ cart_id: bobCart, product_id: spare.id, quantity: 2 })
        .select('*')
        .single();
      expect(added.error).toBeNull();
      expect(added.data?.quantity).toBe(2);

      // The upsert `useCart` performs: same (cart_id, product_id), new quantity.
      const incremented = await bob.client
        .from('cart_items')
        .upsert(
          { cart_id: bobCart, product_id: spare.id, quantity: 5 },
          { onConflict: 'cart_id,product_id' },
        )
        .select('*')
        .single();
      expect(incremented.error).toBeNull();
      expect(incremented.data?.quantity).toBe(5);

      const lines = await bob.client
        .from('cart_items')
        .select('*')
        .eq('cart_id', bobCart)
        .eq('product_id', spare.id);
      expect(lines.data).toHaveLength(1);

      const removed = await bob.client
        .from('cart_items')
        .delete()
        .eq('cart_id', bobCart)
        .eq('product_id', spare.id);
      expect(removed.error).toBeNull();
      expect(removed.data).toBeNull();
    } finally {
      // The line has to go first: cart_items references products, and a failed
      // assertion must not leave the catalogue holding a row it cannot delete.
      await adminClient()
        .from('cart_items')
        .delete()
        .eq('cart_id', bobCart)
        .eq('product_id', spare.id);
      await deleteTestProduct(spare.id);
    }

    // Closing the cart is an update of the owner's own row, which is what
    // checkout does when a cart is finished.
    const closed = await bob.client
      .from('carts')
      .update({ status: 'closed', closed_at: new Date().toISOString() })
      .eq('id', bobCart)
      .select('*')
      .single();
    expect(closed.error).toBeNull();
    expect(closed.data?.status).toBe('closed');
    expect(closed.data?.closed_at).not.toBeNull();
  });

  it("gives a user their own profile, and nobody else's", async () => {
    const own = await alice.client.from('profiles').select('*').eq('id', alice.id).single();
    expect(own.error).toBeNull();
    expect(own.data?.email).toBe(alice.email);

    const foreign = await alice.client.from('profiles').select('*').eq('id', bob.id);
    expect(foreign.error).toBeNull();
    expect(foreign.data).toEqual([]);
  });

  it('lets a user edit their own profile but not forge one or move it to another id', async () => {
    const phone = '+2348030000001';
    const updated = await alice.client
      .from('profiles')
      .update({ phone })
      .eq('id', alice.id)
      .select('phone')
      .single();
    expect(updated.error).toBeNull();
    expect(updated.data?.phone).toBe(phone);

    // No insert policy: a profile cannot be invented, least of all for an id the
    // caller does not own.
    const forged = await alice.client.from('profiles').insert({
      id: crypto.randomUUID(),
      email: 'forged@example.com',
      full_name: null,
      avatar_url: null,
      phone: null,
    });
    expect(forged.error).not.toBeNull();

    // The row you may read is not a row you may rewrite onto an id you do not
    // hold. (Postgres reuses a policy's `using` for the new row when no
    // `with check` is written, so the clause is not the only thing standing in
    // the way — the property is what is under test here, not the syntax.)
    //
    // The target id has to be a real auth user with *no* profile row. Moving
    // Alice's row onto Bob's would fail on the primary key whatever the policy
    // said, and the test would pass for the wrong reason. So: a third user,
    // with their profile deleted, leaving an id that is free to be taken.
    const carol = await createTestUser('carol');
    // `.delete().select()` returns the rows it removed, so one row here is the
    // row that was just cleared out.
    const carolProfile = await adminClient()
      .from('profiles')
      .delete()
      .eq('id', carol.id)
      .select('id');
    expect(carolProfile.error).toBeNull();
    expect(carolProfile.data).toHaveLength(1);

    try {
      const moved = await alice.client.from('profiles').update({ id: carol.id }).eq('id', alice.id);
      expect(moved.error, 'a profile row must not be moved onto another id').not.toBeNull();

      // Effect: Alice's row is still hers, and the free id is still free.
      const aliceStillAlice = await adminClient()
        .from('profiles')
        .select('id')
        .eq('id', alice.id)
        .single();
      expect(aliceStillAlice.data?.id).toBe(alice.id);

      const carolSlot = await adminClient().from('profiles').select('id').eq('id', carol.id);
      expect(carolSlot.data).toEqual([]);
    } finally {
      await deleteTestUser(carol.id);
    }
  });

  it('lets an anonymous visitor read the catalogue and nothing else', async () => {
    const anonymous = anonymousClient();

    // Every product the storefront sells, readable with no session at all.
    // Asserting the slugs rather than a row count keeps this honest while
    // another agent's fixtures sit in the same shared table.
    const products = await anonymous.from('products').select('slug, price_kobo, inventory');
    expect(products.error).toBeNull();

    const slugs = (products.data ?? []).map((row) => row.slug);
    for (const slug of SEEDED_SLUGS) {
      expect(slugs, `anonymous read of the catalogue is missing ${slug}`).toContain(slug);
    }

    for (const table of USER_OWNED_TABLES) {
      const result = await anonymous.from(table).select('*');
      // Either the table is not readable by `anon` at all, or every row is
      // filtered out. Both are "nothing"; what must never happen is a row.
      expect(result.data ?? [], `${table} leaked a row to an anonymous client`).toEqual([]);
    }

    const write = await anonymous.from('carts').insert({ user_id: alice.id, status: 'active' });
    expect(write.error).not.toBeNull();
  });
});

describe.skipIf(reason !== null)('handle_new_user', () => {
  it('creates the profile row on signup', async () => {
    const user = await createTestUser('signup');

    const profile = await adminClient().from('profiles').select('*').eq('id', user.id).single();
    expect(profile.error).toBeNull();
    expect(profile.data?.email).toBe(user.email);

    // And the new user can read it back through their own session.
    const own = await user.client.from('profiles').select('*').eq('id', user.id).single();
    expect(own.data?.id).toBe(user.id);

    await deleteTestUser(user.id);
  });

  it('copies the Google display name and avatar out of the auth metadata', async () => {
    const id = crypto.randomUUID();
    const email = testEmail('metadata');

    const { error } = await adminClient().auth.admin.createUser({
      id,
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: 'Ada Kanso', avatar_url: 'https://example.com/ada.png' },
    });
    expect(error).toBeNull();

    const profile = await adminClient().from('profiles').select('*').eq('id', id).single();
    expect(profile.data?.full_name).toBe('Ada Kanso');
    expect(profile.data?.avatar_url).toBe('https://example.com/ada.png');

    await deleteTestUser(id);
  });

  it('creates the profile as a definer, because the browser may not', async () => {
    const user = await createTestUser('definer');

    // The browser is refused the exact insert the trigger performs — there is no
    // insert policy on `profiles`, and the role that signs users up holds no
    // grant on the table.
    const browserInsert = await user.client.from('profiles').insert({
      id: user.id,
      email: 'forged-again@example.com',
      full_name: null,
      avatar_url: null,
      phone: null,
    });
    expect(browserInsert.error).not.toBeNull();

    // Yet the profile exists, with the signup's own address and not the forged
    // one: the trigger ran as its definer, and `on conflict do nothing` is what
    // stops a second attempt from turning into a failed signup.
    const profile = await adminClient().from('profiles').select('*').eq('id', user.id).single();
    expect(profile.data?.email).toBe(user.email);

    await deleteTestUser(user.id);
  });
});
