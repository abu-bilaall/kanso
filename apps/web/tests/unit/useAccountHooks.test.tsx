/**
 * Contract tests for `useAuth`, `useCart`, `useOrder` and `useOrders`, against a
 * recording Supabase double and the real `AuthProvider`.
 *
 * The cart and order hooks are the ones with money and ownership in them, so the
 * assertions here are deliberately about behaviour a downstream agent would
 * otherwise have to rediscover: what gets upserted, what an over-large quantity
 * does, and that an ownership filter is present on every order query.
 */

import { renderHook as renderHookRaw, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth, useCart, useOrder, useOrders } from '@/hooks';
import { logger } from '@/lib/logger';
import type {
  Cart,
  CartItemWithProduct,
  Order,
  OrderItemWithProduct,
  Product,
} from '@/lib/supabase.types';
import { createFakeSupabase, type FakeSupabase, type ScriptedAnswer } from './helpers/fakeSupabase';
import { supabaseHolder } from './helpers/supabaseHolder';

// Declared here, not in a helper: Vitest hoists `vi.mock` above this file's
// imports, so the hooks bind the double rather than the real client.
vi.mock('@/lib/supabase', async () => {
  const actual = await vi.importActual<typeof import('@/lib/supabase')>('@/lib/supabase');
  return {
    ...actual,
    getSupabaseClient: () => {
      if (supabaseHolder.current === null) {
        throw new Error('No fake Supabase client installed for this test.');
      }
      return supabaseHolder.current;
    },
  };
});

const USER_ID = 'user-a';

const PRODUCT: Product = {
  id: 'p-1',
  slug: 'graphite-desk-pad',
  name: 'Graphite Desk Pad',
  category: 'desk',
  spec_line: 'Dense wool felt / 900x400mm',
  description: null,
  price_kobo: 1850000,
  inventory: 24,
  image_path: null,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
};

const CART: Cart = {
  id: 'cart-1',
  user_id: USER_ID,
  status: 'active',
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
  closed_at: null,
};

const CART_ITEM: CartItemWithProduct = {
  id: 'ci-1',
  cart_id: CART.id,
  product_id: PRODUCT.id,
  quantity: 2,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
  product: PRODUCT,
};

const ORDER: Order = {
  id: 'order-1',
  reference: 'KS-8902-DX',
  user_id: USER_ID,
  status: 'confirmed',
  email: 'marcus.v@example.com',
  phone: '+2348030000000',
  full_name: 'Marcus Vance',
  address_line1: '1044 Industrial Way',
  address_line2: null,
  city: 'Lagos',
  state: 'Lagos',
  country: 'Nigeria',
  subtotal_kobo: 3700000,
  total_kobo: 3700000,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
};

const ORDER_ITEM: OrderItemWithProduct = {
  id: 'oi-1',
  order_id: ORDER.id,
  product_id: PRODUCT.id,
  product_name: 'Graphite Desk Pad',
  quantity: 2,
  unit_price_kobo: 1850000,
  created_at: '2026-10-01T00:00:00.000Z',
  product: { id: PRODUCT.id, slug: PRODUCT.slug, name: PRODUCT.name },
};

/** Answers for a cart that already exists with one line in it. */
const LOADED_CART: Record<string, ScriptedAnswer> = {
  'carts.select': CART,
  'cart_items.select': [CART_ITEM],
};

/** Answers for a signed-out visitor: no session, so no query should be issued. */
function install(
  answer: Record<string, ScriptedAnswer>,
  session: { id: string } | null = { id: USER_ID },
): FakeSupabase {
  const client = createFakeSupabase(
    { session: session === null ? null : { user: { id: session.id } } },
    answer,
  );
  supabaseHolder.current = client;
  return client;
}

/**
 * Every hook here reads the session through the real `AuthProvider` — only the
 * Supabase client underneath is a double. Mocking the provider would make these
 * tests assert nothing.
 */
function renderHookWithProviders<T>(useHook: () => T) {
  return renderHookRaw(useHook, {
    wrapper: ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>,
  });
}

beforeEach(() => {
  supabaseHolder.current = null;
  logger.setLevel('silent');
});

/* ===========================================================================
   useAuth
   =========================================================================== */

describe('useAuth', () => {
  it('settles on anonymous when there is no session', async () => {
    install({}, null);

    const { result } = renderHookWithProviders(() => useAuth());

    expect(result.current.status).toBe('loading');
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.status).toBe('anonymous'));
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('settles on authenticated and exposes the user id', async () => {
    install({});

    const { result } = renderHookWithProviders(() => useAuth());

    await waitFor(() => expect(result.current.status).toBe('authenticated'));
    expect(result.current.user?.id).toBe(USER_ID);
    expect(result.current.isAuthenticated).toBe(true);
  });

  it('reports a failed session read as an error, not as signed out', async () => {
    install({});
    const client = supabaseHolder.current;
    client?.auth.getSession.mockResolvedValue({
      data: { session: null },
      error: { message: 'network down', status: 503 },
    });

    const { result } = renderHookWithProviders(() => useAuth());

    await waitFor(() => expect(result.current.status).toBe('error'));
    // Conflating these two is how a user gets bounced to a sign-in screen while
    // signed in. They must stay distinguishable.
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.error).not.toBeNull();
  });

  it('emits a canonical wide event once the session is read', async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'info').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    logger.setLevel('info');

    try {
      install({}, null);
      const { result } = renderHookWithProviders(() => useAuth());
      await waitFor(() => expect(result.current.status).toBe('anonymous'));

      const events = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
      const read = events.find((entry) => entry.event === 'session_read');
      expect(read).toBeDefined();
      // Environment context is attached centrally, so no call site has to.
      expect(read?.app).toBe('kanso-web');
      expect(read?.authenticated).toBe(false);
    } finally {
      spy.mockRestore();
      logger.setLevel('silent');
    }
  });
});

/* ===========================================================================
   useCart
   =========================================================================== */

describe('useCart', () => {
  it('stays idle and issues no query when signed out', async () => {
    const client = install({}, null);

    const { result } = renderHookWithProviders(() => useCart());

    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(client.calls).toHaveLength(0);
    expect(result.current.cart).toBeNull();
    expect(result.current.items).toEqual([]);
    expect(result.current.subtotalKobo).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it('loads the active cart and derives count and subtotal from server prices', async () => {
    install(LOADED_CART);

    const { result } = renderHookWithProviders(() => useCart());
    await waitFor(() => expect(result.current.status).toBe('success'));

    expect(result.current.cart?.id).toBe(CART.id);
    expect(result.current.itemCount).toBe(2);
    // 2 x 1,850,000 kobo. Integer arithmetic only.
    expect(result.current.subtotalKobo).toBe(3700000);
  });

  it('scopes the cart query to the authenticated user', async () => {
    const client = install(LOADED_CART);

    const { result } = renderHookWithProviders(() => useCart());
    await waitFor(() => expect(result.current.status).toBe('success'));

    expect(client.calls[0]?.table).toBe('carts');
    expect(client.calls[0]?.filters).toEqual([
      ['user_id', USER_ID],
      ['status', 'active'],
    ]);
  });

  it('creates a cart on first use when the user has none', async () => {
    const client = install({
      'carts.select': null,
      'carts.insert': CART,
      'cart_items.select': [],
    });

    const { result } = renderHookWithProviders(() => useCart());
    await waitFor(() => expect(result.current.status).toBe('success'));

    const insert = client.calls.find((call) => call.op === 'insert');
    expect(insert?.table).toBe('carts');
    expect(insert?.payload).toEqual({ user_id: USER_ID, status: 'active' });
  });

  it('upserts an added item onto the (cart_id, product_id) conflict', async () => {
    const client = install({ ...LOADED_CART, 'products.select': { ...PRODUCT, id: 'p-new' } });

    const { result } = renderHookWithProviders(() => useCart());
    await waitFor(() => expect(result.current.status).toBe('success'));

    await result.current.addItem('p-new', 3);

    const upsert = client.calls.find((call) => call.op === 'upsert');
    expect(upsert?.table).toBe('cart_items');
    expect(upsert?.payload).toEqual({ cart_id: CART.id, product_id: 'p-new', quantity: 3 });
  });

  it('refuses a quantity beyond the live inventory and names the product', async () => {
    const client = install({
      ...LOADED_CART,
      'products.select': { ...PRODUCT, id: 'p-new', inventory: 5 },
    });

    const { result } = renderHookWithProviders(() => useCart());
    await waitFor(() => expect(result.current.status).toBe('success'));

    await expect(result.current.addItem('p-new', 6)).rejects.toMatchObject({
      code: 'insufficient_inventory',
      available: 5,
    });
    expect(client.calls.some((call) => call.op === 'upsert')).toBe(false);
  });

  it('adds to an existing line rather than creating a second row', async () => {
    const client = install({ ...LOADED_CART, 'products.select': PRODUCT });

    const { result } = renderHookWithProviders(() => useCart());
    await waitFor(() => expect(result.current.status).toBe('success'));

    await result.current.addItem(PRODUCT.id, 1);

    const upsert = client.calls.find((call) => call.op === 'upsert');
    // 2 already in the cart + 1 requested, still one row.
    expect(upsert?.payload?.quantity).toBe(3);
  });

  it('deletes the line when the quantity is set to zero', async () => {
    const client = install(LOADED_CART);

    const { result } = renderHookWithProviders(() => useCart());
    await waitFor(() => expect(result.current.status).toBe('success'));

    await result.current.setItemQuantity(PRODUCT.id, 0);

    const deletion = client.calls.find((call) => call.op === 'delete');
    expect(deletion?.table).toBe('cart_items');
    expect(deletion?.filters).toEqual([
      ['cart_id', CART.id],
      ['product_id', PRODUCT.id],
    ]);
  });

  it('clamps a quantity edit to live inventory', async () => {
    install({ ...LOADED_CART, 'products.select': { ...PRODUCT, inventory: 2 } });

    const { result } = renderHookWithProviders(() => useCart());
    await waitFor(() => expect(result.current.status).toBe('success'));

    await expect(result.current.setItemQuantity(PRODUCT.id, 9)).rejects.toMatchObject({
      code: 'insufficient_inventory',
    });
  });

  it('degrades into an error state when the cart query fails', async () => {
    install({
      'carts.select': () => ({ data: null, error: { message: 'denied', status: 403 } }),
    });

    const { result } = renderHookWithProviders(() => useCart());
    await waitFor(() => expect(result.current.status).toBe('error'));

    expect(result.current.error?.code).toBe('forbidden');
    expect(result.current.cart).toBeNull();
  });

  it('rejects a mutation outright when signed out', async () => {
    install({}, null);

    const { result } = renderHookWithProviders(() => useCart());
    await waitFor(() => expect(result.current.status).toBe('idle'));

    await expect(result.current.addItem('p-1')).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });
});

/* ===========================================================================
   useOrder / useOrders
   =========================================================================== */

describe('useOrder', () => {
  it('loads an order with its items', async () => {
    install({ 'orders.select': ORDER, 'order_items.select': [ORDER_ITEM] });

    const { result } = renderHookWithProviders(() => useOrder(ORDER.id));
    await waitFor(() => expect(result.current.status).toBe('success'));

    expect(result.current.order?.reference).toBe('KS-8902-DX');
    expect(result.current.items).toHaveLength(1);
    // The snapshot price, not today's catalogue price.
    expect(result.current.items[0]?.unit_price_kobo).toBe(1850000);
  });

  it("filters on user_id as well as id, so it cannot read another user's order", async () => {
    const client = install({ 'orders.select': ORDER, 'order_items.select': [] });

    const { result } = renderHookWithProviders(() => useOrder(ORDER.id));
    await waitFor(() => expect(result.current.status).toBe('success'));

    expect(client.calls[0]?.filters).toEqual([
      ['id', ORDER.id],
      ['user_id', USER_ID],
    ]);
  });

  it('reports a miss as not_found rather than leaking that another user owns it', async () => {
    install({ 'orders.select': null });

    const { result } = renderHookWithProviders(() => useOrder('order-someone-else'));
    await waitFor(() => expect(result.current.status).toBe('error'));

    expect(result.current.error?.code).toBe('not_found');
  });

  it('issues no query without an id', async () => {
    const client = install({ 'orders.select': ORDER });

    const { result } = renderHookWithProviders(() => useOrder(undefined));
    await waitFor(() => expect(result.current.status).toBe('idle'));

    expect(client.calls).toHaveLength(0);
  });
});

describe('useOrders', () => {
  it('returns the history newest first with an item count per order', async () => {
    const client = install({
      'orders.select': [{ ...ORDER, order_items: [{ count: 2 }] }],
    });

    const { result } = renderHookWithProviders(() => useOrders());
    await waitFor(() => expect(result.current.status).toBe('success'));

    expect(result.current.orders).toHaveLength(1);
    expect(result.current.orders[0]?.itemCount).toBe(2);
    expect(client.calls[0]?.orderBy).toEqual([['created_at', false]]);
  });

  it('defaults a missing count to zero rather than undefined', async () => {
    install({ 'orders.select': [ORDER] });

    const { result } = renderHookWithProviders(() => useOrders());
    await waitFor(() => expect(result.current.status).toBe('success'));

    expect(result.current.orders[0]?.itemCount).toBe(0);
    expect('order_items' in (result.current.orders[0] ?? {})).toBe(false);
  });

  it('is idle with no error when signed out', async () => {
    const client = install({}, null);

    const { result } = renderHookWithProviders(() => useOrders());
    await waitFor(() => expect(result.current.status).toBe('idle'));

    expect(client.calls).toHaveLength(0);
    expect(result.current.orders).toEqual([]);
    expect(result.current.error).toBeNull();
  });
});
