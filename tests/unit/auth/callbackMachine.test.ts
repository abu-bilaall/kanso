/**
 * The OAuth callback state machine.
 *
 * This is the core of the account/auth unit suite, and it is written against the
 * pure module rather than the page, so every transition is reachable without a
 * browser, a router or a Supabase double. What is asserted is the *decision* —
 * which state a given redirect plus a given session ends in — because that is
 * the part a refactor can quietly break while the page still looks fine.
 *
 * The destination carried through every case is not decoration: it is the
 * post-login destination, and losing one means a customer lands somewhere other
 * than where they were sent.
 */

import { describe, expect, it } from 'vitest';
import {
  type AuthResponse,
  type CallbackState,
  callbackReducer,
  initialCallbackState,
  parseAuthResponse,
} from '@/features/auth/callbackMachine';
import { AppError } from '@/lib/errors';

const NEXT = '/checkout';

/** The machine one event past mount, for the given redirect payload. */
function resolved(response: AuthResponse): CallbackState {
  return callbackReducer(initialCallbackState(NEXT), { type: 'resolved', response });
}

/* ===========================================================================
   Parsing the redirect
   =========================================================================== */

describe('parseAuthResponse', () => {
  it('reads an implicit-flow fragment as credentials', () => {
    expect(
      parseAuthResponse({
        hash: '#access_token=eyJhbGciOi&token_type=bearer&expires_in=3600&refresh_token=abc',
      }),
    ).toEqual({ kind: 'credentials', flow: 'implicit' });
  });

  it('reads a PKCE query code as credentials', () => {
    expect(parseAuthResponse({ search: '?returnTo=%2Fcart&code=pkce-code-value' })).toEqual({
      kind: 'credentials',
      flow: 'pkce',
    });
  });

  it('reads the user pressing cancel as a denial, not an error', () => {
    // The exact shape GoTrue produces when the consent screen is dismissed.
    expect(
      parseAuthResponse({
        hash: '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid',
      }),
    ).toEqual({ kind: 'denied', providerCode: 'otp_expired' });
  });

  it('reads any other provider failure as an error, keeping the description for the reader', () => {
    expect(
      parseAuthResponse({
        hash: '#error=server_error&error_code=unexpected_failure&error_description=Something+went+wrong',
      }),
    ).toEqual({
      kind: 'error',
      providerCode: 'unexpected_failure',
      description: 'Something went wrong',
    });
  });

  it('resolves one way when a code and a fragment both arrive', () => {
    expect(
      parseAuthResponse({ search: '?code=from-query', hash: '#access_token=from-hash' }),
    ).toEqual({ kind: 'credentials', flow: 'pkce' });
  });

  it('treats a direct visit as nothing to finish rather than a failure', () => {
    expect(parseAuthResponse({})).toEqual({ kind: 'none' });
    expect(parseAuthResponse({ search: '?returnTo=%2Fcheckout' })).toEqual({ kind: 'none' });
  });

  describe('malformed redirects', () => {
    it('rejects an error code with no error to go with it', () => {
      expect(
        parseAuthResponse({ search: '?error_code=otp_expired&error_description=Nope' }),
      ).toEqual({ kind: 'malformed', reason: 'error_without_error_code' });
    });

    it('rejects a credential that arrived empty', () => {
      expect(parseAuthResponse({ search: '?code=' })).toEqual({
        kind: 'malformed',
        reason: 'empty_credential',
      });
      expect(parseAuthResponse({ hash: '#access_token=' })).toEqual({
        kind: 'malformed',
        reason: 'empty_credential',
      });
    });

    it('rejects a parameter it has no meaning for', () => {
      expect(parseAuthResponse({ search: '?session=abc&returnTo=%2Fcart' })).toEqual({
        kind: 'malformed',
        reason: 'unexpected_parameter',
      });
    });

    it('accepts the standard OAuth params alongside a code', () => {
      expect(parseAuthResponse({ search: '?state=xyz&code=pkce-code-value' })).toEqual({
        kind: 'credentials',
        flow: 'pkce',
      });
    });
  });

  it('never carries an unbounded string out of the URL', () => {
    // A hostile or broken provider could put anything in error_code; it is
    // reduced to a short slug before it can reach a log line.
    expect(
      parseAuthResponse({ search: `?error=server_error&error_code=${'a'.repeat(400)}` }),
    ).toEqual({ kind: 'error', providerCode: 'unknown', description: '' });
  });
});

/* ===========================================================================
   Transitions
   =========================================================================== */

describe('callbackReducer', () => {
  it('starts pending with the destination it was given', () => {
    expect(initialCallbackState(NEXT)).toEqual({
      status: 'pending',
      destination: NEXT,
      response: { kind: 'none' },
    });
  });

  describe('pending', () => {
    it('waits for the session when credentials arrived', () => {
      expect(resolved({ kind: 'credentials', flow: 'pkce' })).toEqual({
        status: 'pending',
        destination: NEXT,
        response: { kind: 'credentials', flow: 'pkce' },
      });
    });

    it('waits for the session when nothing recognisable arrived', () => {
      expect(resolved({ kind: 'none' }).status).toBe('pending');
    });

    it('stays pending while the session read is still running', () => {
      const before = resolved({ kind: 'credentials', flow: 'implicit' });
      const after = callbackReducer(before, {
        type: 'session',
        status: 'loading',
        error: null,
      });
      expect(after).toBe(before);
    });
  });

  describe('loading to success', () => {
    it('succeeds on an authenticated session, keeping the destination', () => {
      expect(
        callbackReducer(resolved({ kind: 'credentials', flow: 'pkce' }), {
          type: 'session',
          status: 'authenticated',
          error: null,
        }),
      ).toEqual({ status: 'success', destination: NEXT });
    });

    it('succeeds even with no redirect payload, because the session already exists', () => {
      expect(
        callbackReducer(resolved({ kind: 'none' }), {
          type: 'session',
          status: 'authenticated',
          error: null,
        }),
      ).toEqual({ status: 'success', destination: NEXT });
    });
  });

  describe('loading to failure', () => {
    it('calls it an expired session when credentials came back but no session formed', () => {
      expect(
        callbackReducer(resolved({ kind: 'credentials', flow: 'pkce' }), {
          type: 'session',
          status: 'anonymous',
          error: null,
        }),
      ).toEqual({
        status: 'error',
        destination: NEXT,
        code: 'session_expired',
        reason: null,
        detail: null,
      });
    });

    it('calls it nothing-to-finish when there was no payload and no session', () => {
      expect(
        callbackReducer(resolved({ kind: 'none' }), {
          type: 'session',
          status: 'anonymous',
          error: null,
        }),
      ).toEqual({
        status: 'error',
        destination: NEXT,
        code: 'no_auth_response',
        reason: null,
        detail: null,
      });
    });

    it('surfaces the session read failure message to the reader', () => {
      const error = new AppError('network', 'Could not reach the session store.');
      expect(
        callbackReducer(resolved({ kind: 'credentials', flow: 'implicit' }), {
          type: 'session',
          status: 'error',
          error,
        }),
      ).toEqual({
        status: 'error',
        destination: NEXT,
        code: 'session_failed',
        reason: null,
        detail: 'Could not reach the session store.',
      });
    });

    it('gives up after the timeout rather than spinning forever', () => {
      expect(
        callbackReducer(resolved({ kind: 'credentials', flow: 'pkce' }), { type: 'timed_out' }),
      ).toEqual({
        status: 'error',
        destination: NEXT,
        code: 'session_timeout',
        reason: null,
        detail: null,
      });
    });
  });

  describe('conclusive redirects', () => {
    it('denies on the consent screen, keeping the provider code for the log', () => {
      expect(resolved({ kind: 'denied', providerCode: 'otp_expired' })).toEqual({
        status: 'denied',
        destination: NEXT,
        providerCode: 'otp_expired',
      });
    });

    it('reports a provider failure with its reason, and the description for the reader', () => {
      expect(
        resolved({ kind: 'error', providerCode: 'server_error', description: 'Try again later.' }),
      ).toEqual({
        status: 'error',
        destination: NEXT,
        code: 'provider_error',
        reason: 'server_error',
        detail: 'Try again later.',
      });
    });

    it('reports a malformed redirect with the closed-vocabulary reason only', () => {
      expect(resolved({ kind: 'malformed', reason: 'unexpected_parameter' })).toEqual({
        status: 'error',
        destination: NEXT,
        code: 'malformed_response',
        reason: 'unexpected_parameter',
        detail: null,
      });
    });
  });

  it('does not let a late event overwrite what the screen already said', () => {
    const denied = resolved({ kind: 'denied', providerCode: 'otp_expired' });
    expect(callbackReducer(denied, { type: 'session', status: 'authenticated', error: null })).toBe(
      denied,
    );
    expect(callbackReducer(denied, { type: 'timed_out' })).toBe(denied);
  });
});
