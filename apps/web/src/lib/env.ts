/**
 * Validated browser configuration.
 *
 * The only place `import.meta.env` is read. Everything downstream takes a typed
 * {@link AppEnv}, so a missing key becomes a {@link ConfigurationError} naming the
 * key rather than `undefined` surfacing three layers deep in a Supabase call.
 *
 * Kanso has exactly two browser variables. Both are publishable. The Edge
 * Function secrets (Mailgun, service role) live in Supabase and are never
 * reachable from here — see `.env.example`.
 */

import { z } from 'zod';
import { ConfigurationError } from './errors';

/**
 * `VITE_`-prefixed keys are the only ones Vite exposes to the bundle, so the
 * schema strips the prefix and validates the bare names.
 */
const envSchema = z.object({
  SUPABASE_URL: z
    .string()
    .trim()
    .min(1, 'VITE_SUPABASE_URL is required.')
    .url('VITE_SUPABASE_URL must be a URL, e.g. https://<project-ref>.supabase.co'),
  SUPABASE_PUBLISHABLE_KEY: z.string().trim().min(1, 'VITE_SUPABASE_PUBLISHABLE_KEY is required.'),
});

export interface AppEnv {
  /** Supabase project URL, or the local stack's `http://127.0.0.1:54321`. */
  readonly supabaseUrl: string;
  /** Publishable/anon key. Safe to ship to a browser. Never the service role. */
  readonly supabasePublishableKey: string;
}

export type EnvSource = Record<string, string | boolean | undefined>;

/**
 * Strip the `VITE_` prefix. Vite also injects non-string values (`DEV`,
 * `PROD`, `SSR`, `BASE_URL`, `MODE`), which the schema rejects by shape rather
 * than by name.
 */
function projectEnv(source: EnvSource): EnvSource {
  return {
    SUPABASE_URL: source.VITE_SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: source.VITE_SUPABASE_PUBLISHABLE_KEY,
  };
}

/**
 * Validate a raw environment source. Pure and exported so it can be unit tested
 * without mutating `import.meta.env`.
 *
 * @throws ConfigurationError listing every problem, not just the first.
 */
export function parseEnv(source: EnvSource): AppEnv {
  const result = envSchema.safeParse(projectEnv(source));

  if (!result.success) {
    const problems = result.error.issues.map((issue) => issue.message);
    throw new ConfigurationError(
      `The application is not configured correctly. ${problems.join(' ')} Copy .env.example to .env.local and fill in both VITE_ values.`,
      { details: { problems } },
    );
  }

  return {
    supabaseUrl: result.data.SUPABASE_URL,
    supabasePublishableKey: result.data.SUPABASE_PUBLISHABLE_KEY,
  };
}

let cached: AppEnv | null = null;

/**
 * The validated environment for the running app.
 *
 * Memoised on success. Throws {@link ConfigurationError} when unset — callers in
 * the UI treat that as a normal `error` state rather than letting it escape.
 */
export function getEnv(source?: EnvSource): AppEnv {
  if (cached !== null) return cached;
  cached = parseEnv(source ?? (import.meta.env as EnvSource));
  return cached;
}

/**
 * Non-throwing variant, for code that has a sensible degraded mode — the app
 * shell, for instance, renders fine without a database.
 */
export function tryGetEnv(source?: EnvSource): AppEnv | null {
  try {
    return getEnv(source);
  } catch {
    return null;
  }
}

/**
 * Whether the app has enough configuration to talk to Supabase. Used by
 * {@link useAuth} and friends to choose between "not configured" and "failed".
 */
export function isConfigured(source?: EnvSource): boolean {
  return tryGetEnv(source) !== null;
}
