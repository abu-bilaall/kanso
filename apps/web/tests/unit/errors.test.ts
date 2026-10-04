import { describe, expect, it } from 'vitest';
import { AppError, InsufficientInventoryError, toAppError } from '@/lib/errors';

describe('toAppError', () => {
  it('passes an AppError straight through', () => {
    const original = new InsufficientInventoryError('Only 2 left.', {
      productId: 'p-1',
      available: 2,
    });
    expect(toAppError(original)).toBe(original);
  });

  /**
   * Codes captured from the real local Supabase stack while Phase 1 had no
   * migrations. They are the difference between "the catalogue failed" and "the
   * catalogue has not been built yet", and only one of those is actionable.
   */
  it.each(['PGRST205', 'PGRST200', 'PGRST202', '42P01'])(
    'reads %s as a missing schema rather than a generic failure',
    (code) => {
      const error = toAppError(
        { code, message: "Could not find the table 'public.products' in the schema cache" },
        'Could not load the catalogue',
      );
      expect(error.code).toBe('server');
      expect(error.message).toContain('schema is not available yet');
      expect(error.message).toContain('Could not load the catalogue');
    },
  );

  it('maps RLS refusals to forbidden', () => {
    expect(toAppError({ message: 'denied', status: 403 }).code).toBe('forbidden');
    expect(toAppError({ message: 'denied', code: '42501' }).code).toBe('forbidden');
  });

  it('maps constraint violations to validation', () => {
    expect(toAppError({ message: 'duplicate', code: '23505' }).code).toBe('validation');
    expect(toAppError({ message: 'null', code: '23502' }).code).toBe('validation');
  });

  it('maps an expired session to unauthenticated', () => {
    expect(toAppError({ message: 'JWT expired', status: 401 }).code).toBe('unauthenticated');
  });

  it('maps PGRST116 (no rows) to not_found', () => {
    expect(toAppError({ message: 'no rows', code: 'PGRST116' }).code).toBe('not_found');
  });

  it('maps 5xx to a retryable server error', () => {
    const error = toAppError({ message: 'boom', status: 503 });
    expect(error.code).toBe('server');
    expect(error.retryable).toBe(true);
  });

  it('maps a fetch failure to a retryable network error', () => {
    const error = toAppError(new TypeError('Failed to fetch'), 'Could not load the catalogue');
    expect(error.code).toBe('network');
    expect(error.retryable).toBe(true);
  });

  it('maps an abort to cancelled, which is not a failure to show the user', () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const error = toAppError(abort);
    expect(error.code).toBe('cancelled');
    expect(error.retryable).toBe(false);
  });

  it('does not confuse a plain Error for a PostgREST error', () => {
    const error = toAppError(new Error('something odd'), 'Could not load the catalogue');
    expect(error.code).toBe('unknown');
    expect(error.message).toBe('Could not load the catalogue: something odd');
  });

  it('keeps structured details and never serialises the cause', () => {
    const cause = { password: 'hunter2' };
    const error = toAppError(
      { code: '42P01', message: 'nope', hint: 'apply migrations', cause },
      'x',
    );
    const fields = error.toLogFields();
    expect(fields.details).toEqual({ code: '42P01', hint: 'apply migrations' });
    expect(JSON.stringify(fields)).not.toContain('hunter2');
  });
});

describe('AppError', () => {
  it('is safe to render and flags whether a retry is honest', () => {
    const notFound = new AppError('not_found');
    expect(notFound.message).toBe('We could not find that.');
    expect(notFound.retryable).toBe(false);

    expect(new AppError('rate_limited').retryable).toBe(true);
  });

  it('carries the offending product on an inventory failure', () => {
    const error = new InsufficientInventoryError('Only 2 of Graphite Desk Pad left.', {
      productId: 'p-1',
      available: 2,
    });
    expect(error.code).toBe('insufficient_inventory');
    expect(error.productId).toBe('p-1');
    expect(error.available).toBe(2);
    expect(error.details).toMatchObject({ productId: 'p-1', available: 2 });
  });
});
