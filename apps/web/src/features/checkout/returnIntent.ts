/**
 * Preserving where a customer was going across the OAuth round trip.
 *
 * Hitting `/checkout` signed out is normal, not an error: DESIGN.md's journey is
 * cart → Google Auth → checkout. Google bounces the browser to a Supabase URL
 * and back, and everything the customer had in mind — *finish my checkout* — is
 * gone unless somebody writes it down first.
 *
 * Two channels, deliberately:
 *
 * 1. A `returnTo` search parameter on the OAuth `redirectTo`, which is how every
 *    other OAuth implementation on the web does it and is what A6's callback
 *    page reads.
 * 2. `sessionStorage`, which survives the round trip even if the callback ignores
 *    the parameter, and which is cleared on read so a stale intent can never
 *    resurrect a week later.
 *
 * The value is validated as a same-origin path before it is stored or read. An
 * open redirect here would hand an attacker a Kanso-branded phishing hop, and
 * the value comes from a URL, so it is treated as hostile input.
 */

import { ROUTE_PATHS } from '@/routes';

/** Where the intent is parked between the two halves of the round trip. */
const RETURN_TO_KEY = 'kanso:return-to';

/**
 * A same-origin absolute path, and nothing else.
 *
 * `//evil.com` and `/\evil.com` are protocol-relative URLs that browsers resolve
 * against the *current* scheme, so a naive `startsWith('/')` check turns this
 * into an open redirect. Backslashes are rejected for the same reason.
 */
export function isSafeReturnTo(value: unknown): value is string {
  if (typeof value !== 'string' || !value.startsWith('/')) return false;
  if (value.startsWith('//') || value.startsWith('/\\')) return false;
  return !/^[a-z][a-z0-9+.-]*:/i.test(value);
}

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    // Private browsing modes and blocked third-party storage throw on access.
    // Losing the fallback is survivable; crashing checkout over it is not.
    return null;
  }
}

/** Record where to come back to. Silently skipped when storage is unavailable. */
export function rememberReturnTo(path: string): void {
  if (!isSafeReturnTo(path)) return;
  try {
    storage()?.setItem(RETURN_TO_KEY, path);
  } catch {
    // A full or read-only store is not worth an error the customer cannot act on.
  }
}

/** Read the stored intent and clear it. One-shot, so it cannot loop. */
export function consumeReturnTo(): string | null {
  const store = storage();
  if (store === null) return null;
  try {
    const stored = store.getItem(RETURN_TO_KEY);
    store.removeItem(RETURN_TO_KEY);
    return isSafeReturnTo(stored) ? stored : null;
  } catch {
    return null;
  }
}

/**
 * The URL OAuth should return to, carrying the intent in the query string.
 *
 * `/auth/callback` is the redirect target `useAuth` already defaults to, so it
 * is the one URL the project's allow-list is certain to contain; the destination
 * rides along inside it rather than replacing it.
 */
export function callbackUrlFor(destination: string = ROUTE_PATHS.checkout): string {
  const { origin } = window.location;
  return isSafeReturnTo(destination)
    ? `${origin}${ROUTE_PATHS.authCallback}?returnTo=${encodeURIComponent(destination)}`
    : `${origin}${ROUTE_PATHS.authCallback}`;
}
