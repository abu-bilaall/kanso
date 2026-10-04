/**
 * One cart, not one per call site.
 *
 * `DesktopRail`, `MobileHeader`, `MobileTabBar` and the page under them each
 * call `useCart()`. They used to get a private copy each — four fetches, four
 * badges — so after `create-order` closed the cart server-side the badge kept
 * showing the pre-checkout count on the confirmation screen, and the checkout
 * page could disagree with the badge about what was in the cart.
 *
 * These assertions are about the shared store: one query however many consumers
 * are mounted, a write in one of them visible in all of them, and the documented
 * `useCart` return shape unchanged by any of it.
 */

import { renderHook as renderHookRaw, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useCart } from '@/hooks';
import { logger } from '@/lib/logger';
import type { Cart, CartItemWithProduct, Product } from '@/lib/supabase.types';
import {
  createFakeSupabase,
  type FakeSupabase,
  type ScriptedAnswer,
} from '../helpers/fakeSupabase';
import { supabaseHolder } from '../helpers/supabaseHolder';

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

const DESK_PAD: Product = {
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

const NOTEBOOK: Product = {
  ...DESK_PAD,
  id: 'p-2',
  slug: 'dot-grid-notebook',
  name: 'Dot Grid Notebook',
  price_kobo: 450000,
  inventory: 3,
};

const CART: Cart = {
  id: 'cart-1',
  user_id: USER_ID,
  status: 'active',
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
  closed_at: null,
};

const DESK_PAD_LINE: CartItemWithProduct = {
  id: 'ci-1',
  cart_id: CART.id,
  product_id: DESK_PAD.id,
  quantity: 2,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
  product: DESK_PAD,
};

const NOTEBOOK_LINE: CartItemWithProduct = {
  id: 'ci-2',
  cart_id: CART.id,
  product_id: NOTEBOOK.id,
  quantity: 1,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
  product: NOTEBOOK,
};

/**
 * The cart as the server currently holds it. Tests mutate this to stand in for
 * the write a mutation just made, which is what the store re-reads afterwards.
 */
let serverItems: CartItemWithProduct[] = [DESK_PAD_LINE];

function install(answer: Record<string, ScriptedAnswer> = {}): FakeSupabase {
  const client = createFakeSupabase(
    { session: { user: { id: USER_ID } } },
    {
      'carts.select': CART,
      'cart_items.select': () => ({ data: serverItems }),
      'products.select': NOTEBOOK,
      ...answer,
    },
  );
  supabaseHolder.current = client;
  return client;
}

/** Every hook here reads the session through the real `AuthProvider`. */
function renderCart() {
  return renderHookRaw(() => useCart(), {
    wrapper: ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>,
  });
}

/** How many times the cart itself was read. */
function cartReads(client: FakeSupabase): number {
  return client.calls.filter((call) => call.table === 'carts' && call.op === 'select').length;
}

beforeEach(() => {
  supabaseHolder.current = null;
  serverItems = [DESK_PAD_LINE];
  logger.setLevel('silent');
});

describe('the cart is one shared cart', () => {
  it('reads the cart once however many consumers are mounted', async () => {
    const client = install();

    // Two roots, as the rail and the page are: separate mounts that each call
    // `useCart()`. Before the shared store these were two private carts and two
    // queries, and the two copies could disagree.
    const rail = renderCart();
    const page = renderCart();

    await waitFor(() => expect(rail.result.current.status).toBe('success'));
    await waitFor(() => expect(page.result.current.status).toBe('success'));

    expect(cartReads(client)).toBe(1);
    expect(rail.result.current.itemCount).toBe(2);
    expect(page.result.current.itemCount).toBe(2);
    expect(page.result.current.subtotalKobo).toBe(rail.result.current.subtotalKobo);
  });

  it('shows a write in one consumer to all the others, with no manual refresh', async () => {
    install();
    const rail = renderCart();
    const page = renderCart();

    await waitFor(() => expect(page.result.current.status).toBe('success'));
    expect(page.result.current.itemCount).toBe(2);

    // The rail's cart button adds a line; the server now holds three units
    // across two rows, and the store re-reads after every write.
    serverItems = [DESK_PAD_LINE, NOTEBOOK_LINE];
    await rail.result.current.addItem(NOTEBOOK.id, 1);

    // The page under the rail was never told to refresh, and never asked.
    await waitFor(() => expect(page.result.current.itemCount).toBe(3));
    expect(rail.result.current.itemCount).toBe(3);
    expect(page.result.current.items).toHaveLength(2);
  });

  it('clears the badge everywhere when a consumer empties the cart', async () => {
    install();
    const rail = renderCart();
    const page = renderCart();
    await waitFor(() => expect(page.result.current.status).toBe('success'));

    // This is the shape of the bug that was reported: `create-order` closes the
    // cart server-side, and the confirmation screen still shows the old count.
    serverItems = [];
    await page.result.current.clear();

    await waitFor(() => expect(rail.result.current.itemCount).toBe(0));
    expect(page.result.current.itemCount).toBe(0);
    // The cart itself is still there — `clear` empties it, it does not close it.
    expect(page.result.current.cart?.id).toBe(CART.id);
  });

  it('reports a failed mutation to the caller without breaking the other consumers', async () => {
    install({ 'products.select': { ...NOTEBOOK, inventory: 0 } });
    const rail = renderCart();
    const page = renderCart();
    await waitFor(() => expect(page.result.current.status).toBe('success'));

    // The contract: mutations reject, and the caller surfaces that on the row
    // that caused it. If a rejected mutation also flipped `status` to `error`,
    // one out-of-stock line would replace the whole cart page with an error
    // panel and throw away lines the customer did nothing wrong about.
    await expect(rail.result.current.addItem(NOTEBOOK.id, 1)).rejects.toMatchObject({
      code: 'insufficient_inventory',
      available: 0,
    });

    expect(page.result.current.status).toBe('success');
    expect(page.result.current.error).toBeNull();
    expect(page.result.current.items).toHaveLength(1);
    expect(rail.result.current.isMutating).toBe(false);
    expect(page.result.current.isMutating).toBe(false);
  });

  it('stays loading, not idle, while the session settles', async () => {
    const client = install();
    // A session read that has not come back yet. `Promise.withResolvers` is not
    // in the ES2023 lib this project compiles against.
    client.auth.getSession.mockImplementation(() => new Promise(() => {}));

    const { result } = renderCart();

    // Collapsing these two states is what makes a signed-in user see an empty
    // cart flash on every page load.
    expect(result.current.status).toBe('loading');
    expect(result.current.isLoading).toBe(true);
    expect(cartReads(client)).toBe(0);
  });
});

describe("useCart's public shape", () => {
  it('is exactly what docs/CONTRACTS.md documents', async () => {
    install();
    const { result } = renderCart();
    await waitFor(() => expect(result.current.status).toBe('success'));

    expect(Object.keys(result.current).sort()).toEqual([
      'addItem',
      'cart',
      'clear',
      'error',
      'isLoading',
      'isMutating',
      'itemCount',
      'items',
      'refresh',
      'removeItem',
      'setItemQuantity',
      'status',
      'subtotalKobo',
    ]);

    for (const name of ['refresh', 'addItem', 'setItemQuantity', 'removeItem', 'clear'] as const) {
      expect(typeof result.current[name]).toBe('function');
    }
    expect(result.current.cart?.id).toBe(CART.id);
    expect(result.current.subtotalKobo).toBe(3700000);
  });
});
