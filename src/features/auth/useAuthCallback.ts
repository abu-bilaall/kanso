/**
 * `useAuthCallback` — wires the callback machine to the router and to `useAuth`.
 *
 * All the decisions live in {@link callbackMachine}. This hook supplies the two
 * inputs it needs (the redirect payload, and whatever `useAuth` reports),
 * navigates once the machine says success, and emits the one log line per
 * outcome that `docs/LOGGING.md` reserves for this surface.
 *
 * No token, session or provider description reaches a log line: the machine
 * reduces the redirect to a closed vocabulary before it gets here.
 */

import { useEffect, useReducer, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks';
import { logger } from '@/lib/logger';
import {
  type CallbackState,
  callbackReducer,
  initialCallbackState,
  parseAuthResponse,
} from './callbackMachine';
import { readDestination } from './destination';

/**
 * How long the exchange may take before the screen stops waiting.
 *
 * The PKCE code exchange is a single network round trip; anything past this is
 * a hang, and a screen that spins forever is worse than one that admits it.
 */
const CALLBACK_TIMEOUT_MS = 15_000;

/**
 * How long the success state stays up before continuing.
 *
 * Long enough to be read as a deliberate step rather than a flash — the screen
 * has just spent seconds in a pending state, and going straight to a checkout
 * page reads as a glitch.
 */
const SUCCESS_REDIRECT_MS = 700;

export interface AuthCallbackView {
  state: CallbackState;
  /** The post-login destination that survived the round trip. */
  destination: string;
}

export function useAuthCallback(): AuthCallbackView {
  const { search, hash } = useLocation();
  const { status, error } = useAuth();
  const navigate = useNavigate();

  // Resolved once per distinct `search`, not memoised: reading the stored marker
  // consumes it, and a second render would resolve to the fallback. See
  // `./destination`.
  const resolved = useRef<{ search: string; destination: string } | null>(null);
  if (resolved.current === null || resolved.current.search !== search) {
    resolved.current = { search, destination: readDestination(search) };
  }
  const destination = resolved.current.destination;
  const [state, dispatch] = useReducer(callbackReducer, destination, initialCallbackState);

  const startedAt = useRef<number>(0);
  if (startedAt.current === 0) startedAt.current = Date.now();
  const logged = useRef(false);

  // The redirect payload, read once. React Router exposes both halves of the
  // URL, so the fragment GoTrue appends is available here too.
  useEffect(() => {
    dispatch({ type: 'resolved', response: parseAuthResponse({ search, hash }) });
  }, [search, hash]);

  useEffect(() => {
    dispatch({ type: 'session', status, error });
  }, [status, error]);

  useEffect(() => {
    if (state.status !== 'pending') return;
    const timer = window.setTimeout(() => dispatch({ type: 'timed_out' }), CALLBACK_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [state.status]);

  // One line per callback, per `docs/LOGGING.md`. Guarded so StrictMode's double
  // invocation in development does not double the event.
  useEffect(() => {
    if (state.status === 'pending' || logged.current) return;
    logged.current = true;

    const context = {
      scope: 'auth',
      provider: 'google',
      durationMs: Date.now() - startedAt.current,
      destination: state.destination,
    };

    if (state.status === 'success') {
      logger.info({ event: 'auth_callback_completed', ...context, outcome: 'success' });
    } else if (state.status === 'denied') {
      logger.info({
        event: 'auth_callback_denied',
        ...context,
        outcome: 'failure',
        providerCode: state.providerCode,
      });
    } else {
      logger.error({
        event: 'auth_callback_failed',
        ...context,
        reason: state.code,
        providerCode: state.reason,
      });
    }
  }, [state]);

  useEffect(() => {
    if (state.status !== 'success') return;
    const timer = window.setTimeout(
      () => navigate(state.destination, { replace: true }),
      SUCCESS_REDIRECT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [state, navigate]);

  return { state, destination };
}
