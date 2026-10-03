/**
 * The functional suite must never report success without verifying anything.
 *
 * It used to. `eval "$(supabase status -o env)"` set shell variables that
 * `npm run` did not pass to its child, the suite found no connection, skipped
 * every test, and printed `Tests  1 passed | 28 skipped` — green, and useless.
 *
 * These assertions exist so that failure mode cannot come back. They are unit
 * tests rather than functional ones on purpose: this is the one behaviour that
 * has to hold when the database is *not* available, so testing it cannot require
 * a database.
 */

import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { connectionProblem, requireConnection, resolveConnection } from '../functional/connection';

/** A port nothing is listening on, so "the stack is down" is deterministic. */
const DEAD_STACK = 'http://127.0.0.1:9';

/**
 * Run the real `test:func` entrypoint with a controlled environment and no
 * Supabase CLI on the path, so both failure branches are deterministic and
 * neither one needs the local stack to be up. `process` and `spawnSync` are
 * declared in `tests/types/node-shim.d.ts`.
 */
function runRunner(env: Record<string, string>) {
  return spawnSync(process.execPath, ['scripts/functional-env.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { PATH: '/nonexistent', ...env },
    timeout: 30_000,
  });
}

describe('functional connection resolution', () => {
  it('finds nothing in an empty environment rather than guessing', () => {
    expect(resolveConnection({})).toBeNull();
  });

  it('names the missing values and the way out', () => {
    const problem = connectionProblem(null);

    expect(problem).toContain('API_URL');
    expect(problem).toContain('PUBLISHABLE_KEY');
    expect(problem).toContain('SECRET_KEY');
    expect(problem).toContain('npm run db:start');
  });

  it('refuses a remote project, whatever the keys say', () => {
    const remote = resolveConnection({
      API_URL: 'https://abcdefgh.supabase.co',
      PUBLISHABLE_KEY: 'sb_publishable_x',
      SECRET_KEY: 'sb_secret_x',
    });

    expect(remote).not.toBeNull();
    expect(connectionProblem(remote)).toContain('not the local stack');
  });

  it('accepts the names the Supabase CLI prints', () => {
    expect(
      resolveConnection({
        API_URL: DEAD_STACK,
        PUBLISHABLE_KEY: 'sb_publishable_x',
        SECRET_KEY: 'sb_secret_x',
      }),
    ).toEqual({ url: DEAD_STACK, publishableKey: 'sb_publishable_x', secretKey: 'sb_secret_x' });
  });

  it('throws rather than returning a reason to skip', () => {
    expect(() => requireConnection({})).toThrow(/npm run db:start/);
  });
});

describe('the test:func runner', () => {
  it('fails with instructions when the stack is not answering, rather than skipping', () => {
    const result = runRunner({
      API_URL: DEAD_STACK,
      PUBLISHABLE_KEY: 'sb_publishable_test',
      SECRET_KEY: 'sb_secret_test',
    });

    expect(result.status, 'the runner must exit non-zero').not.toBe(0);
    expect(result.stderr).toContain('Cannot run the functional suite');
    expect(result.stderr).toContain('npm run db:start');
    expect(result.stderr).toContain(DEAD_STACK);
    // The whole point: nothing reached Vitest, so nothing can report as passed.
    expect(result.stdout).not.toContain('skipped');
    expect(result.stdout).not.toContain('passed');
  });

  it('fails with instructions when there are no values and no CLI to ask', () => {
    const result = runRunner({});

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Cannot run the functional suite');
    expect(result.stderr).toContain('supabase status -o env');
  });

  /**
   * CI hands these values over with `supabase status -o env >> $GITHUB_ENV`,
   * and GitHub keeps the double quotes as part of the value. That produced
   * `Tried "http://127.0.0.1:9"/auth/v1/health` and failed the whole run — a
   * defect visible only in CI, because the local route parses the same lines
   * through its own regex and never keeps the quotes. Both routes must converge.
   */
  it('strips the quotes GITHUB_ENV carries, instead of building an unparseable URL', () => {
    const result = runRunner({
      API_URL: `"${DEAD_STACK}"`,
      PUBLISHABLE_KEY: '"sb_publishable_x"',
      SECRET_KEY: '"sb_secret_x"',
    });

    expect(result.stderr).toContain(`Tried ${DEAD_STACK} and got:`);
    // The bug's exact signature: the quotes carried into string concatenation.
    expect(result.stderr).not.toContain('Failed to parse URL');
  });
});
