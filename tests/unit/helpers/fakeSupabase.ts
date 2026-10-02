/**
 * A recording double for the browser Supabase client.
 *
 * Not an in-memory Postgres. It records the query each hook actually issues and
 * returns a scripted answer, because the contract under test is *"what query did
 * you run, and how did you map what came back"* — not PostgREST's own behaviour.
 * Asserting on {@link QueryCall} is how a test notices that `useOrder` quietly
 * stopped filtering on `user_id`, which is a security-relevant regression.
 */

import { vi } from 'vitest';

/** The subset of a PostgREST error the hooks care about. */
export interface PostgrestLikeError {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
  status?: number;
}

export interface QueryCall {
  table: string;
  op: 'select' | 'insert' | 'upsert' | 'update' | 'delete';
  /** Every `.eq()` in order, including ownership filters. */
  filters: Array<[string, unknown]>;
  orderBy: Array<[string, boolean]>;
  /** What the hook asked the driver to return. */
  cardinality: 'many' | 'one' | 'maybe';
  /** Insert/update/upsert body. */
  payload?: Record<string, unknown>;
}

/**
 * A function form lets a test inspect the query before answering it, which is
 * how error-path cases are written.
 */
export type Responder = (call: QueryCall) => { data: unknown; error?: PostgrestLikeError | null };

/**
 * A scripted answer for one `"<table>"` or `"<table>.<op>"` key.
 *
 * `unknown` on purpose: a **plain value is shorthand for `data`** — pass
 * `{ products: [row] }` to mean "selecting products returns these rows". Pass a
 * {@link Responder} when the answer is an error or varies per query. The
 * implementation distinguishes the two with `typeof answer === 'function'`.
 */
export type ScriptedAnswer = unknown;

export interface FakeAuth {
  session: { user: { id: string; app_metadata?: Record<string, unknown> } } | null;
  sessionError?: PostgrestLikeError | null;
  /** When set, `getSession` rejects with it. */
  sessionThrows?: unknown;
}

export interface FakeSupabase {
  /** Every query the client was asked to run, in order. */
  calls: QueryCall[];
  /** The last recorded call, or `undefined`. */
  lastCall: () => QueryCall | undefined;
  auth: {
    getSession: ReturnType<typeof vi.fn>;
    onAuthStateChange: ReturnType<typeof vi.fn>;
    signOut: ReturnType<typeof vi.fn>;
    signInWithOAuth: ReturnType<typeof vi.fn>;
  };
}

/**
 * @param auth   the session the fake auth client reports
 * @param answer scripted results, keyed by `"<table>.<op>"` or just `"<table>"`.
 *               A function receives the whole {@link QueryCall}.
 */
export function createFakeSupabase(
  auth: FakeAuth,
  answer: Record<string, ScriptedAnswer> = {},
): FakeSupabase {
  const calls: QueryCall[] = [];

  const client = {
    calls,
    lastCall: () => calls[calls.length - 1],
    auth: {
      getSession: vi.fn(async () => {
        if (auth.sessionThrows !== undefined) throw auth.sessionThrows;
        if (auth.sessionError !== undefined) {
          return { data: { session: null }, error: auth.sessionError };
        }
        return { data: { session: auth.session }, error: null };
      }),
      onAuthStateChange: vi.fn((_event: unknown, _cb: unknown) => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      signOut: vi.fn(async () => ({ error: null })),
      signInWithOAuth: vi.fn(async () => ({ error: null })),
    },
  } satisfies FakeSupabase;

  const build = (table: string) => {
    const call: QueryCall = { table, op: 'select', filters: [], orderBy: [], cardinality: 'many' };

    const builder = {
      select: () => builder,
      insert(payload: Record<string, unknown>) {
        call.op = 'insert';
        call.payload = payload;
        return builder;
      },
      upsert(payload: Record<string, unknown>, _options?: unknown) {
        call.op = 'upsert';
        call.payload = payload;
        return builder;
      },
      update(payload: Record<string, unknown>) {
        call.op = 'update';
        call.payload = payload;
        return builder;
      },
      delete() {
        call.op = 'delete';
        return builder;
      },
      eq(column: string, value: unknown) {
        call.filters.push([column, value]);
        return builder;
      },
      order(column: string, options?: { ascending?: boolean }) {
        call.orderBy.push([column, options?.ascending !== false]);
        return builder;
      },
      single() {
        call.cardinality = 'one';
        return builder;
      },
      maybeSingle() {
        call.cardinality = 'maybe';
        return builder;
      },
      // biome-ignore lint/suspicious/noThenProperty: supabase-js builders are awaitable by design
      then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
        calls.push({ ...call, filters: [...call.filters], orderBy: [...call.orderBy] });
        const scripted = answer[`${table}.${call.op}`] ?? answer[table];
        // A plain value is shorthand for `data`; only a function can answer with
        // an error. That keeps the common case terse without ambiguity.
        const resolved: { data: unknown; error?: PostgrestLikeError | null } =
          typeof scripted === 'function'
            ? (scripted as Responder)(call)
            : scripted === undefined
              ? { data: null }
              : { data: scripted };
        const error = resolved.error ?? null;
        const value =
          error === null ? { data: resolved.data ?? null, error: null } : { data: null, error };
        return Promise.resolve(value).then(onFulfilled, onRejected);
      },
    };

    return builder;
  };

  return {
    ...client,
    from: (table: string) => build(table),
  } as unknown as FakeSupabase;
}
