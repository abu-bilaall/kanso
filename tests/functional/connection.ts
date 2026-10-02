/**
 * Where the functional suite gets its connection, and when it refuses to run.
 *
 * Split out of `tests/setup/functional.ts` and kept free of side effects so the
 * decision can be unit-tested under Node without a database, and so the setup
 * file is nothing but "read the environment, then fail loudly if it is wrong".
 *
 * Values are read from the process environment, never from `.env.local`: the
 * primary checkout's `.env.local` points at the *remote* project, and a
 * functional suite that quietly connected there would create test users and
 * junk orders in production.
 */

export interface FunctionalConnection {
  readonly url: string;
  readonly publishableKey: string;
  readonly secretKey: string;
}

export type Environment = Record<string, string | undefined>;

/**
 * The three names that matter, each with the aliases CI and older docs use.
 * `supabase status -o env` prints `API_URL`, `PUBLISHABLE_KEY` and
 * `SECRET_KEY`; `PLAN.md` §7 still writes the older `ANON_KEY` /
 * `SERVICE_ROLE_KEY` pair, and both are accepted.
 */
export function resolveConnection(env: Environment): FunctionalConnection | null {
  const url = env.API_URL ?? env.SUPABASE_URL ?? env.VITE_SUPABASE_URL;
  const publishableKey = env.PUBLISHABLE_KEY ?? env.ANON_KEY;
  const secretKey = env.SECRET_KEY ?? env.SERVICE_ROLE_KEY;

  if (!url || !publishableKey || !secretKey) return null;
  return { url, publishableKey, secretKey };
}

/** True when the URL is the local stack rather than a remote project. */
export function isLocalStack(url: string): boolean {
  return url.includes('127.0.0.1') || url.includes('localhost');
}

const HOW_TO_FIX = [
  'Start the local stack and let the runner fetch the values for you:',
  '',
  '  npm run db:start',
  '  npm run test:func',
  '',
  'Or export them yourself, which is what CI does:',
  '',
  '  supabase status -o env >> $GITHUB_ENV',
  '',
  'Note that a bare `eval "$(supabase status -o env)"` is not enough — it sets',
  'shell variables that `npm run` does not pass to its child. That was the',
  'reason this suite used to report success while running nothing.',
].join('\n');

/**
 * Why the functional suite cannot run, or `null` when it can.
 *
 * This is deliberately a *failure* and not a reason to skip: a green run that
 * verified nothing is worse than a red one, because it is indistinguishable from
 * a green run that verified everything.
 */
export function connectionProblem(connection: FunctionalConnection | null): string | null {
  if (connection === null) {
    return [
      'The functional suite cannot run: API_URL, PUBLISHABLE_KEY and SECRET_KEY are not set.',
      '',
      HOW_TO_FIX,
    ].join('\n');
  }

  if (!isLocalStack(connection.url)) {
    return [
      `The functional suite refuses to run: API_URL (${connection.url}) is not the local stack.`,
      'Running it against a remote project would create test users and junk orders in production.',
      '',
      HOW_TO_FIX,
    ].join('\n');
  }

  return null;
}

/**
 * The connection, or a thrown explanation. `tests/setup/functional.ts` calls
 * this at load time, which is what turns "the stack is not configured" from a
 * skipped run into a failed one.
 */
export function requireConnection(env: Environment): FunctionalConnection {
  const connection = resolveConnection(env);
  const problem = connectionProblem(connection);
  if (connection === null || problem !== null) {
    throw new Error(problem ?? 'The functional suite is not configured.');
  }
  return connection;
}
