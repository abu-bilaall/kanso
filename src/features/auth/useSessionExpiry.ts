/**
 * `useSessionExpiry` — tells the difference between a session that ended and a
 * sign-out that was asked for.
 *
 * `useAuth` reports `anonymous` for both. That is the correct shape for a hook
 * and the wrong shape for a reader: a person who signed out expects to be signed
 * out, and a person whose session expired mid-visit is about to be shown an
 * empty account page with no explanation, which reads exactly like losing their
 * order history.
 *
 * So the page asks this. It tracks whether a session existed on this mount and
 * whether the drop was expected; anything else that lands on `anonymous` is an
 * expiry, gets logged once, and gets its own copy on screen.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks';
import { logger } from '@/lib/logger';

export interface SessionExpiry {
  /** A session was here and went away without anyone asking it to. */
  expired: boolean;
  /** Call immediately before an intentional `signOut()`. */
  expectSignOut: () => void;
  /** Undo {@link expectSignOut} — for when the sign-out itself failed. */
  cancelSignOut: () => void;
}

export function useSessionExpiry(): SessionExpiry {
  const { status, isAuthenticated, user } = useAuth();
  const hadSession = useRef(false);
  const expected = useRef(false);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (isAuthenticated) {
      hadSession.current = true;
      expected.current = false;
      setExpired(false);
      return;
    }
    if (status !== 'anonymous' || !hadSession.current || expected.current) return;

    setExpired(true);
    logger.info({ event: 'auth_session_expired', scope: 'auth', userId: user?.id });
  }, [isAuthenticated, status, user?.id]);

  const expectSignOut = useCallback(() => {
    expected.current = true;
  }, []);

  const cancelSignOut = useCallback(() => {
    expected.current = false;
  }, []);

  return { expired, expectSignOut, cancelSignOut };
}
