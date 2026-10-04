/**
 * `/account`.
 *
 * Rendered against a recording Supabase double and the real `AuthProvider`, with
 * only `useOrders` replaced — the page's own state machine, its fallbacks and
 * its sign-out are what is under test.
 *
 * The assertions are about what a reader can see and do, not about what was
 * called: that an order row names its reference, total and status and links to
 * the right order; that an empty history is a designed state rather than a blank
 * one; that a session which disappears mid-visit is announced; and that signing
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, type OrdersState } from '@/hooks';
import { AppError } from '@/lib/errors';
import type { Order } from '@/lib/supabase.types';
import { AccountPage } from '@/pages/account/AccountPage';
import {
  createFakeSupabase,
  type FakeSupabase,
  type ScriptedAnswer,
} from '../helpers/fakeSupabase';
import { supabaseHolder } from '../helpers/supabaseHolder';

// Hoisted: the mock factory below runs while this file's imports are still being
// evaluated, before a top-level `const` would exist.
const ordersHolder = vi.hoisted(() => ({ current: null as OrdersState | null }));

vi.mock('@/hooks/useOrders', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useOrders')>('@/hooks/useOrders');
  return {
    ...actual,
    useOrders: () =>
      ordersHolder.current ?? {
        orders: [],
        status: 'idle',
        error: null,
        isLoading: false,
        refresh: async () => {},
      },
  };
});

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

// A variable rather than an inline literal: the profile view reads Google
// metadata off it, and the access token is the sentinel the logging test uses.
const SESSION_USER = {
  id: USER_ID,
  email: 'marcus.vance@example.com',
  user_metadata: { full_name: 'Marcus Vance', picture: 'https://example.test/avatar.jpg' },
  app_metadata: { provider: 'google' },
  access_token: 'ACCESS-TOKEN-MUST-NEVER-BE-LOGGED',
};

const PROFILE_ROW = {
  id: USER_ID,
  email: SESSION_USER.email,
  full_name: 'Marcus Vance',
  avatar_url: null,
  phone: '+2348030000000',
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
};

const CART = {
  id: 'cart-1',
  user_id: USER_ID,
  status: 'active',
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
  closed_at: null,
};

function order(overrides: Partial<Order> & { itemCount: number }): OrdersState['orders'][number] {
  return {
    id: 'order-1',
    reference: 'KS-8902-DX',
    user_id: USER_ID,
    status: 'confirmed',
    email: SESSION_USER.email,
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
    ...overrides,
  };
}

const LOADED_ORDERS: OrdersState = {
  orders: [
    order({ itemCount: 2 }),
    order({
      id: 'order-0',
      reference: 'KS-7711-AA',
      status: 'cancelled',
      total_kobo: 1850000,
      created_at: '2026-08-14T00:00:00.000Z',
      itemCount: 1,
    }),
  ],
  status: 'success',
  error: null,
  isLoading: false,
  refresh: async () => {},
};

/** A signed-in browser: a session, a cart for the rail badge, and a profile row. */
function install(answer: Record<string, ScriptedAnswer> = {}, signedIn = true): FakeSupabase {
  const client = createFakeSupabase(
    { session: signedIn ? { user: SESSION_USER } : null },
    { 'carts.select': CART, 'cart_items.select': [], 'profiles.select': PROFILE_ROW, ...answer },
  );
  supabaseHolder.current = client;
  return client;
}

/**
 * Install a client whose auth-state subscription can be driven from the test, so
 * a session can be dropped underneath a page that is already on screen.
 */
function installWithAuthEvents(answer: Record<string, ScriptedAnswer> = {}): {
  client: FakeSupabase;
  dropSession: () => void;
} {
  const client = install(answer);
  const listeners: Array<(event: string, session: unknown) => void> = [];

  client.auth.onAuthStateChange.mockImplementation(
    (callback: (event: string, session: unknown) => void) => {
      listeners.push(callback);
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    },
  );

  return {
    client,
    dropSession: () => {
      act(() => {
        for (const listener of listeners) listener('SIGNED_OUT', null);
      });
    },
  };
}

function renderAccount(): void {
  render(
    <MemoryRouter initialEntries={['/account']}>
      <AuthProvider>
        <Routes>
          <Route path="/account" element={<AccountPage />} />
          <Route path="/" element={<p>STOREFRONT</p>} />
          <Route path="/shop" element={<p>CATALOGUE</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  supabaseHolder.current = null;
  ordersHolder.current = null;
});

/* ===========================================================================
   Order history
   =========================================================================== */

describe('AccountPage order history', () => {
  it('names each order and links to its detail', async () => {
    install();
    ordersHolder.current = LOADED_ORDERS;
    renderAccount();

    const row = await screen.findByRole('link', { name: /Order KS-8902-DX/ });
    expect(row).toHaveAttribute('href', '/order/order-1');
    expect(row).toHaveTextContent('1 Oct 2026');
    expect(row).toHaveTextContent('2 items');
    expect(row).toHaveTextContent('₦37,000.00');
    expect(row).toHaveTextContent('Confirmed');

    expect(screen.getByRole('link', { name: /Order KS-7711-AA/ })).toHaveTextContent('Cancelled');
  });

  it('gives an empty history a real design rather than a blank list', async () => {
    install();
    ordersHolder.current = { ...LOADED_ORDERS, orders: [] };
    renderAccount();

    expect(await screen.findByText('No orders yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Browse the catalogue' })).toHaveAttribute(
      'href',
      '/shop',
    );
  });
  it('offers a retry when the history could not be loaded', async () => {
    install();
    ordersHolder.current = {
      orders: [],
      status: 'error',
      error: new AppError('network', 'Could not load your orders'),
      isLoading: false,
      refresh: async () => {},
    };
    renderAccount();

    expect(await screen.findByText('Could not load your orders')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

/* ===========================================================================
   Profile
   =========================================================================== */

describe('AccountPage profile', () => {
  it('reads the profile row when it exists', async () => {
    install();
    renderAccount();

    expect(await screen.findByRole('heading', { name: 'Marcus Vance' })).toBeInTheDocument();
    expect(await screen.findByText('+2348030000000')).toBeInTheDocument();
  });

  it('degrades to the Google account when there is no profile row yet', async () => {
    install({ 'profiles.select': null });
    renderAccount();

    // `waitFor`, not `findBy`: the shared cart store publishes after the query
    // runs, and React swaps the alert's node when it flushes. Re-querying per
    // poll asserts on the DOM that is actually on screen.
    await waitFor(() => {
      expect(screen.getByText('Your profile is still being set up')).toBeInTheDocument();
    });
    expect(screen.getByText(SESSION_USER.email)).toBeInTheDocument();
  });
});

/* ===========================================================================
   Session states
   =========================================================================== */

describe('AccountPage session states', () => {
  it('never flashes a sign-in button at somebody who is signed in', () => {
    // The session read has not settled yet, so the page is still in its first
    // state — the window in which the classic OAuth bug shows a sign-in button
    // at a signed-in reader.
    install();
    renderAccount();

    expect(screen.getByText('Loading your account')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Continue with Google/ })).toBeNull();
  });

  it('shows the sign-in surface to a signed-out visitor', async () => {
    install({}, false);
    renderAccount();

    expect(await screen.findByRole('button', { name: /Continue with Google/ })).toBeInTheDocument();
    expect(screen.queryByText('Your session expired')).toBeNull();
  });

  it('says so when a session that existed disappears mid-visit', async () => {
    const { dropSession } = installWithAuthEvents();
    renderAccount();

    await screen.findByRole('heading', { name: 'Marcus Vance' });
    dropSession();

    expect(await screen.findByText('Your session expired')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Continue with Google/ })).toBeInTheDocument();
  });
});

/* ===========================================================================
   Sign-out
   =========================================================================== */

describe('AccountPage sign-out', () => {
  it('ends the session and leaves for the storefront', async () => {
    const client = install();
    renderAccount();

    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));

    expect(client.auth.signOut).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('STOREFRONT')).toBeInTheDocument();
  });

  it('says so when the sign-out itself fails, without pretending it worked', async () => {
    const client = install();
    client.auth.signOut.mockRejectedValue(new Error('Network request failed'));
    renderAccount();

    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));

    expect(await screen.findByText('Sign-out failed')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Marcus Vance' })).toBeInTheDocument();
  });
});
