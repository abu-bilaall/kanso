/**
 * Functional test harness for the data layer.
 *
 * Every test here runs against the **local** Supabase stack through the Data
 * API, with real JWTs, real RLS and real constraints. Nothing is mocked, because
 * the things being tested — a policy, a partial unique index, a row-level
 * conditional update — do not exist anywhere else.
 *
 * Three rules, because six agents share one database:
 *
 * 1. **A unique email per run.** `kanso-a1-<run>-<label>@example.com`, where
 *    `<run>` is per process. No agent can collide with another agent or with
 *    their own previous run.
 * 2. **No Google OAuth.** Users are created through the admin API, which is
 *    what CI can do. OAuth is verified by hand in Phase 3.
 * 3. **Clean up only what this run created.** Deleting the auth user cascades
 *    to `profiles`, `carts` and `orders`, and from there to the line items. No
 *    test truncates a table, and no test touches a seeded product row: the
 *    fixtures that mutate stock or price are products this run created and
 *    deletes again.
 *
 * Clients are typed with the frozen `Database` contract on purpose. If the
 * migration and `src/lib/supabase.types.ts` ever disagree, this file stops
 * compiling — which is the cheapest possible place to find out.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase.types';
import { connection } from '../../setup/functional';

export type TestClient = SupabaseClient<Database>;
export type TableInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert'];

/** Local-stack dev credential. Never a real one: this suite only ever runs locally. */
export const TEST_PASSWORD = 'kanso-a1-functional-only';

/**
 * Per process and per run. `Date.now()` alone would collide for two agents
 * started in the same second; the random suffix removes that.
 */
const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * The address a test user gets. Unique per run, so two agents sharing the
 * database cannot collide and a rerun cannot collide with itself.
 */
export function testEmail(label: string): string {
  return `kanso-a1-${RUN_ID}-${label}@example.com`;
}

const CLIENT_OPTIONS = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
};

/**
 * The service role. It bypasses RLS by being `BYPASSRLS`, so it is the only way
 * to arrange a fixture that a test then tries to attack from the outside — an
 * order that exists but that the caller must not be able to see.
 */
export function adminClient(): TestClient {
  const { url, secretKey } = connection;
  return createClient<Database>(url, secretKey, CLIENT_OPTIONS);
}

/** The publishable key with no session: an unauthenticated storefront visitor. */
export function anonymousClient(): TestClient {
  const { url, publishableKey } = connection;
  return createClient<Database>(url, publishableKey, CLIENT_OPTIONS);
}

export interface TestUser {
  readonly id: string;
  readonly email: string;
  /** A client holding this user's session. The only view of the world a test gets. */
  readonly client: TestClient;
}

/**
 * Create a user through the admin API and sign in as them.
 *
 * Creating the user fires `handle_new_user`, so the profile row exists before
 * any test runs — which is the real signup path, minus Google.
 */
export async function createTestUser(label: string): Promise<TestUser> {
  const email = testEmail(label);

  const { data, error } = await adminClient().auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });

  if (error !== null) throw new Error(`Could not create test user ${email}: ${error.message}`);
  if (data.user === null) throw new Error(`No user came back for ${email}.`);

  return { id: data.user.id, email, client: await signIn(email) };
}

async function signIn(email: string): Promise<TestClient> {
  const client = anonymousClient();
  const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });

  if (error !== null) {
    throw new Error(
      `Could not sign in ${email}: ${error.message}. The local stack rate-limits ` +
        'sign-ins per IP address (30/hour), so back-to-back runs of the functional ' +
        'suite can hit it. Wait for the window, or lower [auth.rate_limit] in a ' +
        'local config.',
    );
  }

  const { data } = await client.auth.getSession();
  if (data.session === null) throw new Error(`Signing in ${email} produced no session.`);

  return client;
}

/**
 * Remove a test user. `profiles`, `carts` and `orders` cascade from
 * `auth.users`, and the line items cascade from those, so one delete is the
 * whole cleanup.
 */
export async function deleteTestUser(id: string): Promise<void> {
  const { error } = await adminClient().auth.admin.deleteUser(id);
  if (error !== null) throw new Error(`Could not delete test user ${id}: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Fixtures. All of them write with the service role, because the browser is not
// allowed to create any of this — which is itself part of what is being tested.
// ---------------------------------------------------------------------------

/** An active cart, as the browser would create it for itself. */
export async function seedActiveCart(userId: string): Promise<string> {
  const { data, error } = await adminClient()
    .from('carts')
    .insert({ user_id: userId, status: 'active' })
    .select('id')
    .single();

  if (error !== null) throw new Error(`Could not seed a cart: ${error.message}`);
  return data.id;
}

export async function seedCartItem(
  cartId: string,
  productId: string,
  quantity: number,
): Promise<string> {
  const { data, error } = await adminClient()
    .from('cart_items')
    .insert({ cart_id: cartId, product_id: productId, quantity })
    .select('id')
    .single();

  if (error !== null) throw new Error(`Could not seed a cart item: ${error.message}`);
  return data.id;
}

/**
 * A confirmed order. `reference` is deliberately left to the database default so
 * the default is exercised by something other than a comment.
 */
export async function seedOrder(
  userId: string,
  overrides: Partial<TableInsert<'orders'>> = {},
): Promise<string> {
  const row: TableInsert<'orders'> = {
    user_id: userId,
    status: 'confirmed',
    email: 'kanso-a1@example.com',
    phone: '+2348030000000',
    full_name: 'Kanso Fixture',
    address_line1: '1 Test Street',
    address_line2: null,
    city: 'Lagos',
    state: 'Lagos',
    country: 'Nigeria',
    subtotal_kobo: 0,
    total_kobo: 0,
    ...overrides,
  };

  const { data, error } = await adminClient().from('orders').insert(row).select('id').single();
  if (error !== null) throw new Error(`Could not seed an order: ${error.message}`);
  return data.id;
}

export async function seedOrderItem(
  orderId: string,
  product: { id: string; name: string },
  quantity: number,
  unitPriceKobo: number,
): Promise<string> {
  const { data, error } = await adminClient()
    .from('order_items')
    .insert({
      order_id: orderId,
      product_id: product.id,
      product_name: product.name,
      quantity,
      unit_price_kobo: unitPriceKobo,
    })
    .select('id')
    .single();

  if (error !== null) throw new Error(`Could not seed an order item: ${error.message}`);
  return data.id;
}

export interface TestProduct {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

/**
 * A product this run owns. Stock and price tests use one of these rather than a
 * seeded row, so a failing test can never leave the shared catalogue wrong for
 * the next agent.
 */
export async function createTestProduct(
  overrides: Partial<TableInsert<'products'>> = {},
): Promise<TestProduct> {
  const slug = `a1-fixture-${RUN_ID}-${Math.random().toString(36).slice(2, 8)}`;

  const row: TableInsert<'products'> = {
    slug,
    name: 'A1 Fixture Product',
    category: 'desk',
    spec_line: 'Test fixture / not a real product',
    description: 'Created and deleted by the data layer functional suite.',
    price_kobo: 100_000,
    inventory: 10,
    image_path: null,
    ...overrides,
  };

  const { data, error } = await adminClient()
    .from('products')
    .insert(row)
    .select('id, slug, name')
    .single();

  if (error !== null) throw new Error(`Could not create a fixture product: ${error.message}`);
  return data;
}

export async function deleteTestProduct(id: string): Promise<void> {
  const { error } = await adminClient().from('products').delete().eq('id', id);
  if (error !== null) throw new Error(`Could not delete fixture product ${id}: ${error.message}`);
}
