/**
 * `/auth/callback` as a reader meets it.
 *
 * The decisions are tested in `callbackMachine.test.ts`. What is tested here is
 * that each of them reaches the screen as the right words, that the destination
 * survives the round trip and is both offered and used, and that nothing from
 * the redirect ever reaches a log line.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/hooks';
import { logger } from '@/lib/logger';
import { AuthCallbackPage } from '@/pages/auth/AuthCallbackPage';
import { createFakeSupabase, type FakeSupabase } from '../helpers/fakeSupabase';
import { supabaseHolder } from '../helpers/supabaseHolder';

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

const SESSION_USER = {
  id: 'user-a',
  email: 'marcus.vance@example.com',
  user_metadata: {},
  app_metadata: { provider: 'google' },
  access_token: 'ACCESS-TOKEN-MUST-NEVER-BE-LOGGED',
};

function install(signedIn: boolean): FakeSupabase {
  const client = createFakeSupabase(
    { session: signedIn ? { user: SESSION_USER } : null },
    { 'carts.select': null, 'cart_items.select': [] },
  );
  supabaseHolder.current = client;
  return client;
}

function renderCallback(entry: string): void {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <AuthProvider>
        <Routes>
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="/checkout" element={<p>CHECKOUT</p>} />
          <Route path="/account" element={<p>ACCOUNT</p>} />
          <Route path="/shop" element={<p>CATALOGUE</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  supabaseHolder.current = null;
  window.sessionStorage.clear();
});

/* ===========================================================================
   States
   =========================================================================== */

describe('AuthCallbackPage states', () => {
  it('shows a real pending state, not a blank frame', () => {
    // The session read has not settled, so the exchange is still in flight.
    install(true);
    renderCallback('/auth/callback?returnTo=%2Fcheckout#access_token=abc');

    expect(screen.getByRole('heading', { name: 'Finishing your sign-in' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for your sign-in to complete.');
    expect(screen.getByRole('link', { name: 'Back to the shop' })).toHaveAttribute('href', '/shop');
  });

  it('treats a declined consent screen as an ordinary outcome', async () => {
    install(false);
    renderCallback(
      '/auth/callback?returnTo=%2Fcheckout#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid',
    );

    expect(await screen.findByRole('heading', { name: 'Sign-in cancelled' })).toBeInTheDocument();
    expect(screen.getByText(/That is entirely fine/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the shop' })).toBeInTheDocument();
  });

  it('names the provider failure and shows what the provider said', async () => {
    install(false);
    renderCallback(
      '/auth/callback#error=server_error&error_code=unexpected&error_description=Google+is+having+a+moment',
    );

    expect(
      await screen.findByRole('heading', { name: 'Google could not complete the sign-in' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Google is having a moment')).toBeInTheDocument();
  });

  it('says a broken link plainly instead of blaming the reader', async () => {
    install(false);
    renderCallback('/auth/callback?session=abc');

    expect(
      await screen.findByRole('heading', { name: 'That sign-in link did not arrive intact' }),
    ).toBeInTheDocument();
  });

  it('says so when there was never a sign-in to finish', async () => {
    install(false);
    renderCallback('/auth/callback');

    expect(
      await screen.findByRole('heading', { name: 'There was nothing to finish' }),
    ).toBeInTheDocument();
  });

  it('shows the destination it is about to continue to', async () => {
    install(true);
    renderCallback('/auth/callback?returnTo=%2Fcheckout');

    expect(await screen.findByRole('heading', { name: 'You are signed in' })).toBeInTheDocument();
    expect(screen.getByText('Next / /checkout')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue now' })).toHaveAttribute('href', '/checkout');
  });
});

/* ===========================================================================
   The destination across the round trip
   =========================================================================== */

describe('post-login destination', () => {
  it('continues to the destination the user was sent here for', async () => {
    install(true);
    renderCallback('/auth/callback?returnTo=%2Fcheckout');

    expect(await screen.findByText('CHECKOUT', {}, { timeout: 4000 })).toBeInTheDocument();
  });

  it('falls back to the account when the callback carried no destination', async () => {
    install(true);
    renderCallback('/auth/callback');

    expect(await screen.findByText('ACCOUNT', {}, { timeout: 4000 })).toBeInTheDocument();
  });

  it('uses the stored marker when the provider dropped the parameter', async () => {
    window.sessionStorage.setItem('kanso:return-to', '/checkout');
    install(true);
    renderCallback('/auth/callback');

    expect(await screen.findByText('CHECKOUT', {}, { timeout: 4000 })).toBeInTheDocument();
  });

  it('clears the marker so a stale intent cannot bounce somebody back later', async () => {
    window.sessionStorage.setItem('kanso:return-to', '/checkout');
    install(true);
    renderCallback('/auth/callback');

    await screen.findByText('CHECKOUT', {}, { timeout: 4000 });
    expect(window.sessionStorage.getItem('kanso:return-to')).toBeNull();
  });

  it('prefers the parameter over the stored marker', async () => {
    window.sessionStorage.setItem('kanso:return-to', '/shop');
    install(true);
    renderCallback('/auth/callback?returnTo=%2Fcheckout');

    expect(await screen.findByText('CHECKOUT', {}, { timeout: 4000 })).toBeInTheDocument();
  });

  it('refuses a destination that would leave this origin', async () => {
    window.sessionStorage.setItem('kanso:return-to', '/checkout');
    install(true);
    renderCallback('/auth/callback?returnTo=%2F%2Fevil.example');

    // The parameter is rejected, so the stored marker is read instead — never the
    // hostile value.
    expect(await screen.findByText('CHECKOUT', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByText('ACCOUNT')).toBeNull();
  });

  it('lands on the account when the only destination is an off-origin URL', async () => {
    install(true);
    renderCallback('/auth/callback?returnTo=https%3A%2F%2Fevil.example%2Fsteal');

    expect(await screen.findByText('ACCOUNT', {}, { timeout: 4000 })).toBeInTheDocument();
  });

  it('sends the destination back out on the next attempt', async () => {
    const client = install(false);
    renderCallback(
      '/auth/callback?returnTo=%2Fcheckout#error=access_denied&error_code=otp_expired&error_description=Nope',
    );

    await userEvent.click(await screen.findByRole('button', { name: /Try again/ }));

    expect(client.auth.signInWithOAuth).toHaveBeenCalledTimes(1);
    const options = client.auth.signInWithOAuth.mock.calls[0]?.[0];
    const redirectTo: string = options?.options?.redirectTo ?? '';
    expect(new URL(redirectTo).searchParams.get('returnTo')).toBe('/checkout');
  });
});

/* ===========================================================================
   Logging
   =========================================================================== */

describe('AuthCallbackPage logging', () => {
  const lines: string[] = [];

  beforeEach(() => {
    lines.length = 0;
    logger.setLevel('info');
    vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
      lines.push(args.map((arg) => String(arg)).join(' '));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    logger.setLevel('silent');
  });

  it('writes the outcome without the token or the email', async () => {
    install(true);
    renderCallback('/auth/callback?returnTo=%2Fcheckout#access_token=token-in-the-url');

    expect(await screen.findByRole('heading', { name: 'You are signed in' })).toBeInTheDocument();

    const emitted = lines.join('\n');
    expect(emitted).toContain('auth_callback_completed');
    expect(emitted).not.toContain(SESSION_USER.access_token);
    expect(emitted).not.toContain('token-in-the-url');
    expect(emitted).not.toContain(SESSION_USER.email);
  });

  it('records a declined consent without treating it as a crash', async () => {
    install(false);
    renderCallback(
      '/auth/callback#error=access_denied&error_code=otp_expired&error_description=Nope',
    );

    expect(await screen.findByRole('heading', { name: 'Sign-in cancelled' })).toBeInTheDocument();

    await waitFor(() => {
      expect(lines.join('\n')).toContain('auth_callback_denied');
    });
    expect(lines.join('\n')).not.toContain('email');
  });
});
