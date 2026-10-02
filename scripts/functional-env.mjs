#!/usr/bin/env node
/**
 * `npm run test:func` — make the local Supabase stack reachable, then run the
 * functional suite against it.
 *
 * Why this exists. The documented command used to be
 *
 *   eval "$(supabase status -o env)" && npm run test:func
 *
 * and it did not work. The Supabase CLI prints bare `KEY="value"` lines with no
 * `export`, so `eval` sets *shell* variables that `npm run` does not pass to its
 * child process. The suite therefore found no connection, skipped every test,
 * and reported:
 *
 *   Tests  1 passed | 28 skipped
 *
 * which is green. A green run that verified nothing is the failure mode this
 * script exists to remove.
 *
 * What it does, in order:
 *
 *   1. Take the connection values from the environment if they are already
 *      there. That is the CI path (`supabase status -o env >> $GITHUB_ENV`)
 *      and it is left completely alone.
 *   2. Otherwise ask the CLI for them, parsing the bare assignments itself.
 *   3. Refuse to continue unless the stack actually answers, so a stopped
 *      database is a clear error rather than a wall of connection errors.
 *   4. Run Vitest with the values in its environment.
 *
 * Every failure exits non-zero with something to do about it. There is no
 * path from here to "the suite ran zero tests and exited 0".
 */

import { spawn, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stackKeys = ['API_URL', 'PUBLISHABLE_KEY', 'SECRET_KEY'];

function fail(message) {
  process.stderr.write(`\nCannot run the functional suite.\n\n${message}\n\n`);
  process.exit(1);
}

const stackHelp = [
  'The local Supabase stack is not answering.',
  '',
  'Start it, then run the suite again:',
  '',
  '  npm run db:start',
  '  npm run test:func',
  '',
  'Or point the suite at an already-running stack the way CI does:',
  '',
  '  supabase status -o env >> $GITHUB_ENV',
].join('\n');

/**
 * Every `KEY="value"` line the CLI printed. `supabase status -o env` also emits
 * a human line such as `Stopped services: [...]`, which is not an assignment
 * and is ignored — this parser has no list of the names it accepts, because the
 * names belong to `tests/functional/connection.ts`, not to this script.
 */
function parseAssignments(output) {
  const found = {};
  for (const line of output.split('\n')) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)="([^"]*)"\s*$/.exec(line);
    if (match !== null) found[match[1]] = match[2];
  }
  return found;
}

function haveAllStackKeys(env) {
  return stackKeys.every((key) => typeof env[key] === 'string' && env[key].length > 0);
}

function harvestFromCli(env) {
  const cli = spawnSync('supabase', ['status', '-o', 'env'], { encoding: 'utf8' });
  if (cli.error !== undefined || cli.status !== 0) {
    fail(
      `${stackHelp}\n\n` +
        'No connection values were exported, and the Supabase CLI could not be run ' +
        '(`supabase status -o env` failed). Install the CLI, or export API_URL, ' +
        'PUBLISHABLE_KEY and SECRET_KEY yourself.',
    );
  }

  const harvested = parseAssignments(`${cli.stdout ?? ''}\n${cli.stderr ?? ''}`);
  if (!haveAllStackKeys(harvested)) {
    fail(
      `${stackHelp}\n\n` +
        'The Supabase CLI reported no running stack, so there were no connection ' +
        'values to use. Set API_URL, PUBLISHABLE_KEY and SECRET_KEY yourself if ' +
        'you are pointing at a stack this CLI does not manage.',
    );
  }

  return { ...env, ...harvested };
}

/** `fetch` rejecting is the signal; any HTTP status means the stack answered. */
async function stackAnswers(url, apikey) {
  try {
    const response = await fetch(`${url}/auth/v1/health`, {
      headers: apikey === undefined ? {} : { apikey },
      signal: AbortSignal.timeout(5_000),
    });
    return { reachable: true, status: response.status };
  } catch (error) {
    return { reachable: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

async function main() {
  const fromEnvironment = haveAllStackKeys(process.env)
    ? { ...process.env }
    : harvestFromCli(process.env);

  const url = fromEnvironment.API_URL;
  const probe = await stackAnswers(url, fromEnvironment.PUBLISHABLE_KEY);
  if (!probe.reachable) {
    fail(`${stackHelp}\n\nTried ${url} and got: ${probe.reason}`);
  }
  if (probe.status >= 500) {
    fail(`${stackHelp}\n\n${url} answered ${probe.status}, so the stack is not healthy.`);
  }

  const child = spawn(
    process.execPath,
    [resolve(projectRoot, 'node_modules/vitest/vitest.mjs'), 'run', '--project', 'functional'],
    { cwd: projectRoot, stdio: 'inherit', env: fromEnvironment },
  );
  child.on('exit', (code, signal) => {
    process.exit(signal === null ? (code ?? 1) : 1);
  });
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
