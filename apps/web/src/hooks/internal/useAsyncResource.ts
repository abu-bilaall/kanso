/**
 * The single async-resource primitive behind every data hook.
 *
 * Six hooks need the same three things: run an async read, expose a status that
 * is honest about "no result yet", and let a caller re-run it without remounting.
 * This is that, and nothing more.
 *
 * It is internal to `src/hooks` and not part of the public contract. What IS
 * contract is the shape of what it returns, which every hook in `src/hooks`
 * exposes unchanged — see docs/CONTRACTS.md.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';

/** Lifecycle of a read. `idle` is the pre-first-fetch state. */
export type AsyncStatus = 'idle' | 'loading' | 'success' | 'error';

export interface AsyncResource<T> {
  /** The last successful value. Retained across refreshes so a re-fetch does not blank the UI. */
  data: T | null;
  status: AsyncStatus;
  /** Normalised failure. `null` unless `status === 'error'`. */
  error: AppError | null;
  /** True while a request is in flight, including the very first one. */
  isLoading: boolean;
  /** Re-run the read. Safe to call from an event handler. */
  refresh: () => Promise<void>;
}

/**
 * `fetcher` receives an `AbortSignal` so a superseded request (a fast second
 * refresh, or a param change) can be cancelled rather than racing to set state.
 */
export type AsyncFetcher<T> = (signal: AbortSignal) => Promise<T>;

export interface UseAsyncResourceOptions {
  /** When false the fetcher is not run at all and the resource stays `idle`. */
  enabled?: boolean;
  /**
   * Canonical log event name emitted on completion, e.g. `catalogue_loaded`.
   * Pass `null` to log nothing — use that for hooks that poll, where a line per
   * poll would be noise.
   */
  logEvent?: string | null;
  /** Extra fields merged into the log line. Never secrets, never payloads. */
  logFields?: Record<string, unknown>;
}

export function useAsyncResource<T>(
  fetcher: AsyncFetcher<T>,
  options: UseAsyncResourceOptions = {},
): AsyncResource<T> {
  const { enabled = true, logEvent = null, logFields } = options;

  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<AsyncStatus>(enabled ? 'loading' : 'idle');
  const [error, setError] = useState<AppError | null>(null);

  const controllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  // Keep the latest fetcher and log fields without making `refresh` change identity
  // on every render, which would re-trigger the effect in consumers.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const logEventRef = useRef(logEvent);
  logEventRef.current = logEvent;
  const logFieldsRef = useRef(logFields);
  logFieldsRef.current = logFields;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  const refresh = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    const startedAt = Date.now();
    setStatus('loading');

    try {
      const result = await fetcherRef.current(controller.signal);
      if (controller.signal.aborted || !mountedRef.current) return;

      setData(result);
      setError(null);
      setStatus('success');

      if (logEventRef.current !== null) {
        logger.info({
          event: logEventRef.current,
          outcome: 'success',
          durationMs: Date.now() - startedAt,
          ...logFieldsRef.current,
        });
      }
    } catch (thrown) {
      if (controller.signal.aborted || !mountedRef.current) return;

      const normalised = thrown as AppError;
      setError(normalised);
      setStatus('error');

      if (logEventRef.current !== null) {
        logger.error({
          event: logEventRef.current,
          durationMs: Date.now() - startedAt,
          error: normalised,
          ...logFieldsRef.current,
        });
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setStatus('idle');
      return;
    }
    void refresh();
  }, [enabled, refresh]);

  return {
    data,
    status,
    error,
    isLoading: status === 'loading',
    refresh,
  };
}
