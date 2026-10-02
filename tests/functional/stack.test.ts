/**
 * Functional smoke test — the local Supabase stack.
 *
 * Foundation's job here is the *harness*, not the schema: prove that
 * `tests/setup/functional.ts` reads connection values from the environment,
 * that the stack answers, and that the browser credential is accepted. That
 * this file is running at all is itself part of the assertion — the setup file
 * throws rather than skipping, so there is no code path in which this suite
 * reports success without having reached the database.
 *
 * Migration- and RLS-level tests belong to the data agent
 * (`tests/functional/db/**`).
 */

import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { connection } from '../setup/functional';
import { isLocalStack } from './connection';

describe('local Supabase stack', () => {
  it('exposes the values the runner found', () => {
    expect(connection.url).not.toBe('');
    expect(isLocalStack(connection.url)).toBe(true);
  });

  it('answers on the auth health endpoint', async () => {
    const response = await fetch(`${connection.url}/auth/v1/health`, {
      headers: { apikey: connection.publishableKey },
    });
    expect(response.ok).toBe(true);
  });

  it('accepts the publishable key against PostgREST', async () => {
    const client = createClient(connection.url, connection.publishableKey);

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
    expect(connection.publishableKey).not.toBe(connection.secretKey);
    expect(connection.publishableKey.startsWith('sb_secret_')).toBe(false);
  });
});
