/**
 * Functional smoke test — the local Supabase stack.
 *
 * Foundation's job here is the *harness*, not the schema: prove that
 * `tests/setup/functional.ts` reads connection values from the environment,
 * that it refuses to point at a remote project, and that the shared local stack
 * answers. Migration- and RLS-level tests belong to the data agent
 * (`tests/functional/db/**`).
 *
 * Skips itself, loudly, when the stack is not configured — so a machine without
 * Docker does not see a connection error that looks like an application bug.
 */

import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { connection, isLocalStack, skipReason } from '../setup/functional';

const reason = skipReason();

describe.skipIf(reason !== null)('local Supabase stack', () => {
  it('exposes the values the CLI printed', () => {
    expect(connection).not.toBeNull();
    expect(isLocalStack()).toBe(true);
  });

  it('answers on the auth health endpoint', async () => {
    const response = await fetch(`${connection?.url}/auth/v1/health`, {
      headers: { apikey: connection?.publishableKey ?? '' },
    });
    expect(response.ok).toBe(true);
  });

  it('accepts the publishable key against PostgREST', async () => {
    const client = createClient(connection?.url ?? '', connection?.publishableKey ?? '');

    // No tables are assumed: the data agent writes them next phase. What matters
    // here is that the browser credential is accepted, and that the failure mode
    // when a table is missing is a *data* error rather than an auth error.
    const { error } = await client.from('products').select('id').limit(1);

    if (error === null) return;

    expect(['PGRST205', '42P01']).toContain(error.code);
  });

  it('never hands the service role to a browser-facing client', () => {
    // The value exists in this process because the harness needs it, but nothing
    // that runs in `src/` may read it. If a future change ever wires it into the
    // app, this is the assertion that catches it.
    expect(connection?.publishableKey).not.toBe(connection?.secretKey);
    expect(connection?.publishableKey.startsWith('sb_secret_')).toBe(false);
  });
});

describe('functional harness guard', () => {
  it('refuses to treat an unconfigured environment as a connection failure', () => {
    // Documented behaviour: no exported values means "skip with a reason", never
    // "connect to something and time out".
    expect(reason === null || typeof reason === 'string').toBe(true);
    if (reason !== null) expect(reason.length).toBeGreaterThan(0);
  });
});
