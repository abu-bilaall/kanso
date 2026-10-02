/**
 * `useAuth` — the single source of truth for the signed-in session.
 *
 * Mount {@link AuthProvider} once, at the root of the app (see `src/main.tsx`).
 * Every other hook in `src/hooks` reads from it rather than calling
 * `supabase.auth` directly, which is what keeps session state from drifting
 * between components.
 *
 * ## What it guarantees
 *
 * - `status` is `'loading'` until the initial session read settles. Render
 *   spinners, not "signed out", during that window — flashing the sign-in button
 *   at a signed-in user is the classic OAuth bug.
 * - `'anonymous'` means genuinely no session. `'error'` means the read failed,
 *   and `error` says why. The two are never conflated.
 * - Nothing here throws. A missing `VITE_` configuration surfaces as
 *   `status: 'error'` with a `ConfigurationError`, so the app still renders.
 *
 * ## Ownership
 *
 * The Supabase auth session lives in local storage and survives reloads; this
 * hook mirrors it into React state and subscribes to changes. It does not
 * persist anything itself.
 */

import type { Session, Subscription, User } from '@supabase/supabase-js';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { type AppError, ConfigurationError, toAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { getSupabaseClient, type Supabase } from '@/lib/supabase';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous' | 'error';

export interface AuthState {
  status: AuthStatus;
  /** `null` unless `status === 'authenticated'`. */
  user: User | null;
  session: Session | null;
  error: AppError | null;
  /** True only while the initial read is in flight. */
  isLoading: boolean;
  /** `status === 'authenticated'`. The form every route guard wants. */
  isAuthenticated: boolean;
  /**
   * Start Google OAuth.
   *
   * @param redirectTo Absolute URL to land on after the callback. Defaults to
   *        `<origin>/auth/callback`.
   * @returns Resolves once the browser has been redirected. Rejects with an
   *          `AppError` if sign-in could not be started — that rejection is
   *          already logged; surface it inline, do not crash.
   */
  signInWithGoogle: (options?: { redirectTo?: string }) => Promise<void>;
  /** Clear the session. Resolves when Supabase has dropped it. */
  signOut: () => Promise<void>;
  /** Re-read the session from Supabase. */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * The state returned when there is no {@link AuthProvider} above the caller, or
 * when Supabase is not configured at all. Present so the shell renders and the
 * rest of the app has a context to read, without pretending anyone is signed in.
 */
const UNAUTHENTICATED_STATE: AuthState = {
  status: 'error',
  user: null,
  session: null,
  error: new ConfigurationError('Supabase is not configured. Add the VITE_ values to .env.local.'),
  isLoading: false,
  isAuthenticated: false,
  signInWithGoogle: () => Promise.reject(new ConfigurationError('Supabase is not configured.')),
  signOut: () => Promise.resolve(),
  refresh: () => Promise.resolve(),
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() => ({
    ...UNAUTHENTICATED_STATE,
    status: 'loading',
    error: null,
    isLoading: true,
  }));

  /**
   * Supabase's auth client, or `null` when the app is unconfigured. Resolved
   * inside an effect rather than at render so a configuration error cannot
   * escape into the component tree.
   */
  const clientRef = useRef<Supabase | null>(null);
  const subscriptionRef = useRef<Subscription | null>(null);

  useEffect(() => {
    let active = true;

    let client: Supabase;
    try {
      client = getSupabaseClient();
      clientRef.current = client;
    } catch (thrown) {
      const error = toAppError(thrown, 'Could not start authentication');
      setState({
        ...UNAUTHENTICATED_STATE,
        error:
          error instanceof ConfigurationError
            ? error
            : new ConfigurationError(error.message, { cause: error }),
      });
      return;
    }

    const applySession = (session: Session | null, initial: boolean): void => {
      if (!active) return;

      logger.info({
        event: initial ? 'session_read' : 'session_changed',
        scope: 'auth',
        outcome: 'success',
        authenticated: session !== null,
        userId: session?.user.id,
        provider: session?.user.app_metadata?.provider,
      });

      setState((previous) => ({
        ...previous,
        status: session === null ? 'anonymous' : 'authenticated',
        user: session?.user ?? null,
        session,
        error: null,
        isLoading: false,
      }));
    };

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) => {
      applySession(session, false);
    });
    subscriptionRef.current = subscription;

    void client.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setState((previous) => ({
            ...previous,
            status: 'error',
            error: toAppError(error, 'Could not read your session'),
            isLoading: false,
          }));
          return;
        }
        applySession(data.session, true);
      })
      .catch((thrown: unknown) => {
        if (!active) return;
        setState((previous) => ({
          ...previous,
          status: 'error',
          error: toAppError(thrown, 'Could not read your session'),
          isLoading: false,
        }));
      });

    return () => {
      active = false;
      subscriptionRef.current?.unsubscribe();
      subscriptionRef.current = null;
    };
  }, []);

  const signInWithGoogle = useCallback(async (options?: { redirectTo?: string }): Promise<void> => {
    const client = clientRef.current;
    if (client === null) {
      throw new ConfigurationError('Supabase is not configured.');
    }

    const startedAt = Date.now();
    const redirectTo = options?.redirectTo ?? `${window.location.origin}/auth/callback`;

    try {
      const { error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo },
      });
      if (error) throw error;
      logger.info({
        event: 'auth_signin_started',
        scope: 'auth',
        outcome: 'success',
        provider: 'google',
        redirectTo,
      });
    } catch (thrown) {
      const error = toAppError(thrown, 'Could not start Google sign-in');
      logger.error({
        event: 'auth_signin_started',
        scope: 'auth',
        durationMs: Date.now() - startedAt,
        error,
      });
      throw error;
    }
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    if (client === null) return;

    const startedAt = Date.now();
    try {
      const { error } = await client.auth.signOut();
      if (error) throw error;
      logger.info({
        event: 'auth_signout',
        scope: 'auth',
        outcome: 'success',
        durationMs: Date.now() - startedAt,
      });
    } catch (thrown) {
      const error = toAppError(thrown, 'Could not sign you out');
      logger.error({
        event: 'auth_signout',
        scope: 'auth',
        durationMs: Date.now() - startedAt,
        error,
      });
      throw error;
    }
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    if (client === null) return;
    const { data, error } = await client.auth.getSession();
    if (error) {
      setState((previous) => ({
        ...previous,
        status: 'error',
        error: toAppError(error, 'Could not read your session'),
        isLoading: false,
      }));
      return;
    }
    setState((previous) => ({
      ...previous,
      status: data.session === null ? 'anonymous' : 'authenticated',
      user: data.session?.user ?? null,
      session: data.session,
      error: null,
      isLoading: false,
    }));
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      status: state.status,
      user: state.user,
      session: state.session,
      error: state.error,
      isLoading: state.isLoading,
      isAuthenticated: state.status === 'authenticated',
      signInWithGoogle,
      signOut,
      refresh,
    }),
    [state, signInWithGoogle, signOut, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Read the session.
 *
 * @throws Never. Outside an {@link AuthProvider}, or with no configuration, it
 *         returns a fully-formed `error` state so a component can render an
 *         error panel instead of crashing.
 */
export function useAuth(): AuthState {
  return useContext(AuthContext) ?? UNAUTHENTICATED_STATE;
}

/**
 * The authenticated user id, or `null`. The convenience most guards want:
 * `if (!userId) return <SignIn />`.
 */
export function useUserId(): string | null {
  return useAuth().user?.id ?? null;
}
