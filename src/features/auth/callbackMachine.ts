/**
 * The OAuth callback state machine.
 *
 * `/auth/callback` is the one screen where the browser can be handed something
 * it does not understand: a fragment GoTrue appended, an error the user caused
 * on purpose, a code that silently fails to exchange, or nothing at all because
 * somebody bookmarked the URL. Each of those is a different thing to say to
 * somebody, so they are different states rather than one boolean.
 *
 * This module is **pure** — no React, no router, no Supabase. It takes the
 * redirect's query string and hash plus whatever `useAuth` last reported, and
 * returns the next state. Everything interesting, and everything tested, lives
 * here; the page component only renders what this says and decides when to
 * navigate.
 *
 * ```
 *                    ┌───────────────────────────────┐
 *   (mount) ───────▶ │ pending                       │◀── session: loading
 *                    └──────┬─────────────────┬──────┘
 *         credentials ──────┘                 └──── none ────┐
 *               │                                             │
 *               │ session: authenticated                      │ session: authenticated
 *               ▼                                             ▼
 *           success ◀─────────────────────────────────────── success
 *
 *   A `resolved` event carrying denied / provider error / malformed response
 *   goes straight to a terminal state without passing through pending.
 *
 *   pending ── session: anonymous ──▶ error
 *   pending ── session: error ──────▶ error
 *   pending ── timed_out ───────────▶ error
 * ```
 *
 * ## The four states
 *
 * | State     | Means                                                | Tone |
 * | --------- | ---------------------------------------------------- | ---- |
 * | `pending` | Still in flight. Never a blank screen.               | — |
 * | `success` | A session exists. Continue to the preserved destination. | — |
 * | `denied`  | The user said no. A normal outcome, not a failure.   | calm |
 * | `error`   | Anything else, with a code that names which thing.   | plain |
 */

import type { AppError } from '@/lib/errors';

/* ===========================================================================
   The redirect payload
   =========================================================================== */

/**
 * What the browser was handed when it arrived.
 *
 * `none` and `credentials` are the two shapes that still need the session to
 * settle; `denied`, `error` and `malformed` are already conclusive.
 */
export type AuthResponse =
  /** Nothing recognisable arrived. A direct visit, not a failed sign-in. */
  | { kind: 'none' }
  /** Tokens or an authorization code are present; the session may still form. */
  | { kind: 'credentials'; flow: 'implicit' | 'pkce' }
  /** The user declined consent at the provider. */
  | { kind: 'denied'; providerCode: string }
  /** The provider or GoTrue reported a failure. */
  | { kind: 'error'; providerCode: string; description: string }
  /** Something arrived that this is not equipped to interpret. */
  | { kind: 'malformed'; reason: MalformedReason };

/** The two responses that leave the machine waiting on the session. */
export type PendingResponse = Extract<AuthResponse, { kind: 'none' | 'credentials' }>;

/**
 * Every reason a redirect can be uninterpretable, as a closed vocabulary.
 *
 * Closed on purpose: this value is written to the log, so it must not be able to
 * carry whatever bytes the URL happened to contain.
 */
export type MalformedReason =
  /** A credential key was present but empty. */
  | 'empty_credential'
  /** `error_description` or `error_code` arrived with no `error` to go with it. */
  | 'error_without_error_code'
  /** A parameter this screen has no meaning for. */
  | 'unexpected_parameter';

/**
 * Parameters Supabase and the OAuth providers actually send.
 *
 * Anything outside this table — plus `next`, which is ours — is
 * `unexpected_parameter`: a link that has been truncated, mangled by a proxy, or
 * hand-edited.
 */
const KNOWN_PARAMS: Record<string, true> = {
  returnTo: true,
  error: true,
  error_code: true,
  error_description: true,
  error_uri: true,
  code: true,
  access_token: true,
  token_type: true,
  expires_in: true,
  refresh_token: true,
  provider_token: true,
  provider_refresh_token: true,
  state: true,
};

/**
 * Read a redirect's query string and fragment.
 * Both are consulted because Supabase answers with a fragment under the implicit
 * flow and with `?code=` under PKCE, and the flow is the provider's choice, not
 * the app's. Where both halves carry the same key the fragment wins — it is
 * appended last — and `code` is tested before `access_token` so that a redirect
 * carrying both, which should not happen, still resolves one way rather than
 * two.
 */
export function parseAuthResponse(parts: { search?: string; hash?: string }): AuthResponse {
  const search = new URLSearchParams(parts.search?.replace(/^[?#]/, '') ?? '');
  const hash = new URLSearchParams(parts.hash?.replace(/^[?#]/, '') ?? '');
  const get = (key: string): string | null => hash.get(key) ?? search.get(key);

  const error = get('error');
  if (error !== null && error.length > 0) {
    if (error === 'access_denied') {
      return { kind: 'denied', providerCode: providerCode(get('error_code')) };
    }
    return {
      kind: 'error',
      providerCode: providerCode(get('error_code')),
      description: get('error_description')?.trim() ?? '',
    };
  }

  // An error code with no error name is GoTrue's own shape being broken, not a
  // provider decision. Anything that is not a decision is uninterpretable.
  if (get('error_code') !== null || get('error_description') !== null) {
    return { kind: 'malformed', reason: 'error_without_error_code' };
  }

  const code = get('code');
  if (code !== null) {
    return code.length === 0
      ? { kind: 'malformed', reason: 'empty_credential' }
      : { kind: 'credentials', flow: 'pkce' };
  }

  const accessToken = get('access_token');
  if (accessToken !== null) {
    return accessToken.length === 0
      ? { kind: 'malformed', reason: 'empty_credential' }
      : { kind: 'credentials', flow: 'implicit' };
  }

  for (const key of [...search.keys(), ...hash.keys()]) {
    if (KNOWN_PARAMS[key] !== true) {
      return { kind: 'malformed', reason: 'unexpected_parameter' };
    }
  }

  return { kind: 'none' };
}

/**
 * A short, loggable identifier for whatever failed.
 *
 * GoTrue and the providers use slugs like `otp_expired` and `access_denied`.
 * Anything longer, or not shaped like one, is somebody else's idea of a value
 * and is reported as `unknown` — a redirect parameter is untrusted input and
 * this is the line that carries it.
 */
export function providerCode(raw: string | null | undefined): string {
  return typeof raw === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(raw) ? raw : 'unknown';
}

/* ===========================================================================
   The machine
   =========================================================================== */

/** Why the callback could not finish. One code per way a reader can act. */
export type CallbackErrorCode =
  /** Arrived with no sign-in payload and no session either. */
  | 'no_auth_response'
  /** Something arrived that is not a sign-in response. */
  | 'malformed_response'
  /** GoTrue or the provider reported a failure. */
  | 'provider_error'
  /** The session read itself failed. */
  | 'session_failed'
  /** Credentials came back but no session formed. */
  | 'session_expired'
  /** The exchange never settled. */
  | 'session_timeout';

type PendingState = { status: 'pending'; destination: string; response: PendingResponse };

export type CallbackState =
  | PendingState
  | { status: 'success'; destination: string }
  | { status: 'denied'; destination: string; providerCode: string }
  | {
      status: 'error';
      destination: string;
      code: CallbackErrorCode;
      /** Closed vocabulary. Safe to log. */
      reason: string | null;
      /** The provider's own sentence. Rendered, never logged. */
      detail: string | null;
    };

export type CallbackEvent =
  /** The redirect payload has been read. Sent once, on mount. */
  | { type: 'resolved'; response: AuthResponse }
  /** Whatever `useAuth` currently reports. */
  | {
      type: 'session';
      status: 'loading' | 'authenticated' | 'anonymous' | 'error';
      error: AppError | null;
    }
  /** The exchange has taken too long. */
  | { type: 'timed_out' };

export function initialCallbackState(destination: string): CallbackState {
  return { status: 'pending', destination, response: { kind: 'none' } };
}

/**
 * The transition function.
 *
 * Terminal states are terminal: once the screen has said what happened, a late
 * session event cannot overwrite it with a spinner.
 */
export function callbackReducer(state: CallbackState, event: CallbackEvent): CallbackState {
  if (state.status !== 'pending') return state;

  switch (event.type) {
    case 'resolved':
      return reduceResponse(state.destination, event.response);

    case 'session':
      switch (event.status) {
        case 'loading':
          return state;
        case 'authenticated':
          return { status: 'success', destination: state.destination };
        case 'anonymous':
          return fail(
            state,
            state.response.kind === 'credentials' ? 'session_expired' : 'no_auth_response',
            null,
            null,
          );
        case 'error':
          return fail(
            state,
            'session_failed',
            null,
            event.error?.message ?? 'We could not read your session.',
          );
      }
      break;

    case 'timed_out':
      return fail(state, 'session_timeout', null, null);
  }

  return state;
}

function reduceResponse(destination: string, response: AuthResponse): CallbackState {
  switch (response.kind) {
    case 'denied':
      return { status: 'denied', destination, providerCode: response.providerCode };
    case 'error':
      return {
        status: 'error',
        destination,
        code: 'provider_error',
        reason: response.providerCode,
        detail: response.description.length > 0 ? response.description : null,
      };
    case 'malformed':
      return {
        status: 'error',
        destination,
        code: 'malformed_response',
        reason: response.reason,
        detail: null,
      };
    case 'credentials':
    case 'none':
      return { status: 'pending', destination, response };
  }
}

function fail(
  state: PendingState,
  code: CallbackErrorCode,
  reason: string | null,
  detail: string | null,
): CallbackState {
  return { status: 'error', destination: state.destination, code, reason, detail };
}

/* ===========================================================================
   Copy
   =========================================================================== */

/**
 * Headings for the failure states.
 *
 * Plain, and about what happened rather than what went wrong. A provider that
 * rejected the exchange is not the reader's fault and the wording does not
 * pretend otherwise.
 */
export const CALLBACK_ERROR_TITLES: Record<CallbackErrorCode, string> = {
  no_auth_response: 'There was nothing to finish',
  malformed_response: 'That sign-in link did not arrive intact',
  provider_error: 'Google could not complete the sign-in',
  session_failed: 'We could not read your session',
  session_expired: 'Your session expired',
  session_timeout: 'The sign-in took too long',
};

/**
 * One sentence under each heading.
 *
 * All six close by saying the account was not changed, because that is the
 * question somebody actually has when a sign-in falls over.
 */
export const CALLBACK_ERROR_BODIES: Record<CallbackErrorCode, string> = {
  no_auth_response: 'This is not a sign-in link. If you meant to sign in, start again below.',
  malformed_response:
    'Part of the link Google sent back did not survive the trip. Starting again usually fixes it.',
  provider_error:
    'Google would not complete the exchange. This is usually temporary — trying again is the fix.',
  session_failed: 'We could not read the session that came back. Nothing was changed.',
  session_expired: 'The sign-in expired before we could finish it. Nothing was changed.',
  session_timeout: 'The sign-in did not finish in time. Nothing was changed.',
};
