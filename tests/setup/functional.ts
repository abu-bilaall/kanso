/**
 * Functional test setup.
 *
 * Functional tests hit the **local** Supabase stack. Connection values are read
 * from the process environment, never from `.env.local` — the primary
 * checkout's `.env.local` points at the *remote* project, and a functional suite
 * that silently connected there would create test users and junk orders in
 * production.
 *
 * Export them first:
 *
 *   eval "$(supabase status -o env)" && npm run test:func
 *
 * or the CI equivalent, `supabase status -o env >> $GITHUB_ENV`.
 *
 * When they are absent, every functional suite skips itself with a message
 * rather than failing with a connection error that looks like an application bug.
 */

/**
 * The only Node global this file needs. Declared locally rather than pulling in
 * `@types/node` for one property: the browser app has no legitimate use for the
 * Node type surface, and `@types/node` is not a pre-approved dependency.
 */
declare const process: { env: Record<string, string | undefined> };

export interface FunctionalConnection {
  url: string;
  publishableKey: string;
  secretKey: string;
}

function readConnection(): FunctionalConnection | null {
  const url = process.env.API_URL ?? process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const publishableKey = process.env.PUBLISHABLE_KEY ?? process.env.ANON_KEY;
  const secretKey = process.env.SECRET_KEY ?? process.env.SERVICE_ROLE_KEY;

  if (!url || !publishableKey || !secretKey) return null;
  return { url, publishableKey, secretKey };
}

/** The live connection, or `null` when the local stack is not configured. */
export const connection: FunctionalConnection | null = readConnection();

/** True when the stack is the local one rather than a remote project. */
export function isLocalStack(): boolean {
  const url = connection?.url ?? '';
  return url.includes('127.0.0.1') || url.includes('localhost');
}

/**
 * Why the functional suite is not running, or `null` when it can. Suites call
 * this from `describe.skipIf(...)` with a human-readable reason.
 */
export function skipReason(): string | null {
  if (connection === null) {
    return 'Local Supabase connection values are not exported. Run: eval "$(supabase status -o env)"';
  }
  if (!isLocalStack()) {
    return `API_URL (${connection.url}) is not the local stack. Refusing to run functional tests against a remote project.`;
  }
  return null;
}
