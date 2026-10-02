/**
 * The browser Supabase client.
 *
 * SECURITY CONTRACT — read before changing anything:
 *
 *   - This module may only ever hold **publishable** credentials. A publishable
 *     key starts `sb_publishable_` (current) or is an `anon`-role JWT (legacy).
 *   - {@link ForbiddenCredentialError} is thrown at **module evaluation time** if a
 *     secret credential is present in `import.meta.env`. That is deliberate
 *     fail-fast: a leaked service-role key is a production incident, and the
 *     cheapest place to catch it is before the app renders.
 *   - Never import a service-role key here, and never add a `VITE_SERVICE_ROLE`
 *     variable to `.env.example`.
 *
 * The client is created lazily. Importing this module must never throw for a
 * *missing* configuration — only for a *forbidden* one — so the app shell renders
 * and each hook reports a clean `error` state when the environment is incomplete.
 */

import type { Session } from '@supabase/supabase-js';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { type EnvSource, getEnv } from './env';
import { ForbiddenCredentialError, toAppError } from './errors';
import { logger } from './logger';
import type { Database } from './supabase.types';

export type Supabase = SupabaseClient<Database>;

/** Keys that must never appear in a browser bundle, `VITE_` prefix or not. */
const FORBIDDEN_ENV_KEYS = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_ADMIN_KEY',
  'VITE_SUPABASE_SERVICE_ROLE_KEY',
  'VITE_SUPABASE_SECRET_KEY',
  'MAILGUN_API_KEY',
  'MAILGUN_DOMAIN',
  'MAILGUN_FROM',
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_DB_PASSWORD',
  'SUPABASE_JWT_SECRET',
] as const;

/** `sb_secret_...` is the current secret-key format. */
const SECRET_KEY_PREFIX = 'sb_secret_';

function decodeJwtRole(token: string): string | null {
  const segments = token.split('.');
  if (segments.length !== 3) return null;
  const payload = segments[1];
  if (payload === undefined) return null;
  try {
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed === 'object' && parsed !== null) {
      const role = (parsed as { role?: unknown }).role;
      return typeof role === 'string' ? role : null;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Fail fast when the bundle contains a secret credential.
 *
 * @throws ForbiddenCredentialError
 */
export function assertNoSecretCredentials(source?: EnvSource): void {
  const env = (source ?? (import.meta.env as EnvSource)) as Record<string, string | undefined>;

  const leaked = FORBIDDEN_ENV_KEYS.filter((key) => {
    const value = env[key];
    return typeof value === 'string' && value.length > 0;
  });
  if (leaked.length > 0) {
    throw new ForbiddenCredentialError(
      `Refusing to start: secret credential(s) ${leaked.join(', ')} are present in the browser environment. ` +
        'The browser bundle must only ever contain the publishable key.',
      { details: { keys: leaked } },
    );
  }

  const publishable = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (typeof publishable !== 'string' || publishable.length === 0) return;

  if (publishable.startsWith(SECRET_KEY_PREFIX)) {
    throw new ForbiddenCredentialError(
      'Refusing to start: VITE_SUPABASE_PUBLISHABLE_KEY holds a secret key (sb_secret_...). ' +
        'Only the publishable key may be exposed to the browser.',
      { details: { key: 'VITE_SUPABASE_PUBLISHABLE_KEY' } },
    );
  }

  // Legacy projects hand out a JWT whose `role` claim is `service_role`.
  const role = decodeJwtRole(publishable);
  if (role === 'service_role') {
    throw new ForbiddenCredentialError(
      'Refusing to start: VITE_SUPABASE_PUBLISHABLE_KEY holds a service-role JWT. ' +
        'Only the publishable (or legacy anon) key may be exposed to the browser.',
      { details: { key: 'VITE_SUPABASE_PUBLISHABLE_KEY', role } },
    );
  }
}

// The module-level assertion. Runs once, before any React code touches a client.
assertNoSecretCredentials();

let client: Supabase | null = null;

/**
 * The memoised browser client.
 *
 * @throws ConfigurationError when the `VITE_` values are missing or malformed.
 *         Hooks catch this and surface it as `error` state; the app shell does
 *         not call this at all.
 */
export function getSupabaseClient(): Supabase {
  if (client !== null) return client;

  const env = getEnv();

  client = createClient<Database>(env.supabaseUrl, env.supabasePublishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
    global: {
      headers: { 'x-application-name': 'kanso-web' },
    },
  });

  logger.info({
    event: 'supabase_client_created',
    outcome: 'success',
    supabaseHost: new URL(env.supabaseUrl).host,
  });

  return client;
}

/**
 * Read the current session without a round trip where possible.
 *
 * `getSession()` reads from local storage and only hits the network to validate
 * an expired token, so this is safe to call on render.
 */
export async function getSession(): Promise<Session | null> {
  const { data, error } = await getSupabaseClient().auth.getSession();
  if (error) throw toAppError(error, 'Could not read your session');
  return data.session;
}

/**
 * Reset the memoised client. Tests only — every hook test needs a fresh client
 * so one test's mock never leaks into the next.
 */
export function resetSupabaseClientForTests(): void {
  client = null;
}
