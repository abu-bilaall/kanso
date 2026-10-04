/**
 * Typed application errors.
 *
 * Every error that crosses a service or feature boundary — Supabase, Auth, an
 * Edge Function, Zod — is normalised into an {@link AppError} so that UI code
 * makes decisions from `error.code` and never string-matches a message.
 *
 * Rules:
 *   - `AppError` is safe to render: `message` is written for a human.
 *   - `details` is structured, machine-readable context (never raw payloads).
 *   - `retryable` tells the UI whether offering "Try again" is honest.
 *
 * See docs/CONTRACTS.md for the full contract.
 */

export const APP_ERROR_CODES = [
  'configuration',
  'unauthenticated',
  'forbidden',
  'not_found',
  'validation',
  'insufficient_inventory',
  'rate_limited',
  'network',
  'server',
  'cancelled',
  'unknown',
] as const;

export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

export interface AppErrorOptions {
  /** HTTP status when the error came from a request. */
  status?: number;
  /** Machine-readable context. Must never contain credentials or full payloads. */
  details?: Record<string, unknown>;
  /** The underlying error. Never serialised into a log line's top-level fields. */
  cause?: unknown;
  /** Overrides the default retryability for this code. */
  retryable?: boolean;
}

/**
 * Retryability defaults per code. "Can the user usefully try the same thing
 * again?" is the question, not "is the network probably up?".
 */
const RETRYABLE_BY_DEFAULT: Readonly<Record<AppErrorCode, boolean>> = {
  configuration: false,
  unauthenticated: false,
  forbidden: false,
  not_found: false,
  validation: false,
  insufficient_inventory: false,
  rate_limited: true,
  network: true,
  server: true,
  cancelled: false,
  unknown: false,
};

/** Human-readable fallback per code, used when nothing better is available. */
const DEFAULT_MESSAGE: Readonly<Record<AppErrorCode, string>> = {
  configuration: 'The application is not configured correctly.',
  unauthenticated: 'You need to sign in to continue.',
  forbidden: 'You do not have access to that.',
  not_found: 'We could not find that.',
  validation: 'Some of the details you entered are not valid.',
  insufficient_inventory: 'Some items are no longer available in that quantity.',
  rate_limited: 'Too many requests. Please wait a moment and try again.',
  network: 'We could not reach the server. Check your connection and try again.',
  server: 'Something went wrong on our side. Please try again.',
  cancelled: 'That request was cancelled.',
  unknown: 'Something went wrong.',
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number | undefined;
  readonly details: Record<string, unknown> | undefined;
  readonly retryable: boolean;

  constructor(code: AppErrorCode, message?: string, options: AppErrorOptions = {}) {
    super(
      message ?? DEFAULT_MESSAGE[code],
      options.cause === undefined ? {} : { cause: options.cause },
    );
    this.name = 'AppError';
    this.code = code;
    this.status = options.status;
    this.details = options.details;
    this.retryable = options.retryable ?? RETRYABLE_BY_DEFAULT[code];
  }

  /** Narrow structural check that survives bundling and cross-realm failures. */
  static is(value: unknown): value is AppError {
    return value instanceof AppError
      ? true
      : typeof value === 'object' &&
          value !== null &&
          (value as { name?: unknown }).name === 'AppError' &&
          typeof (value as { code?: unknown }).code === 'string';
  }

  /** Shape safe to put in a structured log line. Never includes `cause`. */
  toLogFields(): {
    code: AppErrorCode;
    message: string;
    status?: number;
    details?: Record<string, unknown>;
  } {
    return {
      code: this.code,
      message: this.message,
      ...(this.status === undefined ? {} : { status: this.status }),
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }
}

/**
 * The order-creation failure that checkout has to word carefully: the order may
 * not have been created at all. Carries the offending product so the UI can name
 * it, as SPEC requires.
 */
export class InsufficientInventoryError extends AppError {
  readonly productId: string | undefined;
  readonly available: number | undefined;

  constructor(
    message: string,
    options: AppErrorOptions & { productId?: string; available?: number } = {},
  ) {
    super('insufficient_inventory', message, {
      ...options,
      details: {
        ...options.details,
        ...(options.productId === undefined ? {} : { productId: options.productId }),
        ...(options.available === undefined ? {} : { available: options.available }),
      },
    });
    this.name = 'InsufficientInventoryError';
    this.productId = options.productId;
    this.available = options.available;
  }
}

/** Configuration failed at boot — a missing or malformed `VITE_` value. */
export class ConfigurationError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super('configuration', message, options);
    this.name = 'ConfigurationError';
  }
}

/**
 * Raised by `src/lib/supabase.ts` at module load when a secret credential has
 * leaked into the browser bundle. This is a fail-fast security assertion, not a
 * user-facing failure — see the module comment there.
 */
export class ForbiddenCredentialError extends ConfigurationError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, options);
    this.name = 'ForbiddenCredentialError';
  }
}

interface PostgrestLikeError {
  message?: unknown;
  code?: unknown;
  status?: unknown;
  details?: unknown;
  hint?: unknown;
}

/**
 * PostgREST / Postgres codes meaning "the relation you asked for is not in the
 * schema", as opposed to "your query was wrong". Observed against the local
 * stack: `PGRST205` for a missing table, `PGRST200`/`PGRST202` for a missing
 * embedded relation, `42P01` for the underlying undefined_table.
 */
const SCHEMA_MISSING_CODES = new Set(['PGRST200', 'PGRST202', 'PGRST205', '42P01']);

/**
 * Normalise anything thrown by Supabase (PostgREST, Auth, Realtime, fetch, the
 * network) into an {@link AppError}.
 *
 * `context` is a short noun phrase describing the operation that failed, used to
 * build a message that is useful on its own — "Could not load the catalogue"
 * beats "TypeError: Failed to fetch".
 */

export function toAppError(error: unknown, context?: string): AppError {
  if (AppError.is(error)) {
    return error as AppError;
  }

  const prefix = context
    ? `${context[0]?.toUpperCase() ?? ''}${context.slice(1)}`
    : 'That did not work';
  const candidate = asPostgrestLike(error);

  if (candidate) {
    const status = typeof candidate.status === 'number' ? candidate.status : undefined;
    const details = buildDetails(candidate);

    // A table the browser expects but the database does not have. In practice
    // this means the schema has not been migrated yet — say so, rather than
    // reporting a generic failure the reader cannot act on.
    if (SCHEMA_MISSING_CODES.has(String(candidate.code))) {
      return new AppError('server', `${prefix}: the database schema is not available yet.`, {
        status,
        details,
        cause: error,
      });
    }

    const mapped = mapPostgrestCode(candidate.code, status);
    return new AppError(mapped.code, `${prefix}: ${mapped.message}`, {
      ...(status === undefined ? {} : { status }),
      ...(details === undefined ? {} : { details }),
      cause: error,
    });
  }

  if (isAbort(error)) {
    return new AppError('cancelled', `${prefix}: the request was cancelled.`, { cause: error });
  }

  if (isNetworkFailure(error)) {
    return new AppError('network', `${prefix}: we could not reach the server.`, { cause: error });
  }

  const message = error instanceof Error ? error.message : String(error);
  return new AppError('unknown', `${prefix}: ${message}`, { cause: error });
}

function mapPostgrestCode(
  code: unknown,
  status: number | undefined,
): { code: AppErrorCode; message: string } {
  switch (code) {
    case '23505':
      return { code: 'validation', message: 'that already exists' };
    case '23503':
      return { code: 'validation', message: 'that references something that no longer exists' };
    case '23514':
    case '23502':
      return { code: 'validation', message: 'the database rejected those values' };
    case '42501':
      return { code: 'forbidden', message: 'you do not have access to that' };
    case 'PGRST116':
      return { code: 'not_found', message: 'no rows were returned' };
    default:
      break;
  }

  if (status === 401) return { code: 'unauthenticated', message: 'your session has expired' };
  if (status === 403) return { code: 'forbidden', message: 'you do not have access to that' };
  if (status === 404) return { code: 'not_found', message: 'we could not find that' };
  if (status === 409)
    return { code: 'validation', message: 'that conflicts with the current state' };
  if (status === 429) return { code: 'rate_limited', message: 'too many requests' };
  if (status !== undefined && status >= 500) {
    return { code: 'server', message: 'the server returned an error' };
  }
  return { code: 'unknown', message: 'the request failed' };
}

function asPostgrestLike(error: unknown): PostgrestLikeError | null {
  if (typeof error !== 'object' || error === null) return null;
  const candidate = error as PostgrestLikeError;
  // A plain `new Error('x')` is not a PostgREST error; those always carry a code.
  if (typeof candidate.code !== 'string' && typeof candidate.status !== 'number') return null;
  return candidate;
}

function buildDetails(error: PostgrestLikeError): Record<string, unknown> | undefined {
  const details: Record<string, unknown> = {};
  if (typeof error.code === 'string') details.code = error.code;
  if (typeof error.hint === 'string') details.hint = error.hint;
  if (typeof error.details === 'string') details.details = error.details;
  return Object.keys(details).length > 0 ? details : undefined;
}

function isAbort(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    ((error as { name?: unknown }).name === 'AbortError' ||
      (error as { code?: unknown }).code === 'ABORT_ERR')
  );
}

function isNetworkFailure(error: unknown): boolean {
  if (!(error instanceof TypeError)) return false;
  // `fetch` rejects with a TypeError for DNS, connection refused, CORS and
  // offline. The browser deliberately does not say which.
  return /fetch|network|failed to load/i.test(error.message);
}
