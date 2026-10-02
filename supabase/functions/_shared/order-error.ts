/**
 * Typed errors for the Edge Function.
 *
 * The code vocabulary is `APP_ERROR_CODES` from `src/lib/errors.ts` — a frozen
 * contract surface that the browser's `ErrorState` and `Alert` already switch
 * on, so the server must not invent codes outside it. It is restated here
 * because the frozen `tsconfig.app.json` cannot import that module into the
 * Deno runtime (see `docs/CONTRACT-REQUESTS.md`); a test in
 * `tests/unit/order/` pins this list against the frozen one, so drift fails the
 * build rather than shipping.
 *
 * `toBody()` is the single wire shape for a failed request, and it is
 * deliberately the shape `AppError` serialises to, so checkout can branch on
 * `error.code` and read `error.details` without a translation layer.
 */

export const ORDER_ERROR_CODES = [
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

export type OrderErrorCode = (typeof ORDER_ERROR_CODES)[number];

/** "Can the user usefully do the same thing again?" — drives `ErrorState`. */
const RETRYABLE_BY_DEFAULT: Readonly<Record<OrderErrorCode, boolean>> = {
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

const STATUS_BY_CODE: Readonly<Record<OrderErrorCode, number>> = {
  configuration: 500,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  validation: 422,
  insufficient_inventory: 409,
  rate_limited: 429,
  network: 502,
  server: 500,
  cancelled: 499,
  unknown: 500,
};

export interface OrderErrorOptions {
  status?: number;
  /** Machine-readable context. Never credentials, never a raw payload. */
  details?: Record<string, unknown>;
  retryable?: boolean;
  /**
   * Which step of order creation failed. Server-side only: `toBody()` omits it,
   * because a log line that cannot say which step broke is a log line nobody can
   * act on, and the step is not the customer's business.
   */
  stage?: string;
  cause?: unknown;
}

export interface OrderErrorBody {
  code: OrderErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export class OrderError extends Error {
  readonly code: OrderErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;
  readonly retryable: boolean;
  readonly stage: string | undefined;

  constructor(code: OrderErrorCode, message: string, options: OrderErrorOptions = {}) {
    super(message, options.cause === undefined ? {} : { cause: options.cause });
    this.name = 'OrderError';
    this.code = code;
    this.status = options.status ?? STATUS_BY_CODE[code];
    this.details = options.details;
    this.retryable = options.retryable ?? RETRYABLE_BY_DEFAULT[code];
    this.stage = options.stage;
  }

  /**
   * The response body. `message` is written for a human and is safe to render;
   * `details` is for the machine.
   */
  toBody(): OrderErrorBody {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }
}

/**
 * `stage` names the step that failed and travels on the error rather than in
 * `details`, so there is exactly one `order_create_failed` log line per request
 * and the step never reaches the client.
 */
export function toOrderError(error: unknown, stage: string, context: string): OrderError {
  if (error instanceof OrderError) {
    if (error.stage !== undefined) return error;
    // An error that crossed a port without naming its step — the store's
    // "token rejected", say — is stamped with the step that caught it, so
    // every `order_create_failed` line names one.
    return new OrderError(error.code, error.message, {
      stage,
      status: error.status,
      details: error.details,
      retryable: error.retryable,
      cause: error.cause,
    });
  }
  if (isDatabaseError(error)) return fromDatabaseError(error, stage, context);
  return new OrderError('server', `${context}.`, { stage, cause: error });
}

interface DatabaseError {
  message?: unknown;
  code?: unknown;
  status?: unknown;
  details?: unknown;
  hint?: unknown;
}

function isDatabaseError(value: unknown): value is DatabaseError {
  if (typeof value !== 'object' || value === null) return false;
  const candidate: DatabaseError = value;
  return typeof candidate.code === 'string' || typeof candidate.status === 'number';
}

function fromDatabaseError(error: DatabaseError, stage: string, context: string): OrderError {
  const status = typeof error.status === 'number' ? error.status : undefined;
  const details: Record<string, unknown> = {};
  if (typeof error.code === 'string') details.code = error.code;
  if (typeof error.hint === 'string') details.hint = error.hint;
  if (typeof error.details === 'string') details.details = error.details;

  // The schema agent's migrations have not landed. Saying so beats reporting a
  // generic 500 to a developer staring at an empty database.
  const SCHEMA_MISSING = new Set(['PGRST200', 'PGRST202', 'PGRST205', '42P01']);
  if (typeof error.code === 'string' && SCHEMA_MISSING.has(error.code)) {
    return new OrderError('server', `${context}: the database schema is not available yet.`, {
      stage,
      details,
      cause: error,
    });
  }

  if (status === 401) {
    return new OrderError('unauthenticated', 'Your session has expired. Sign in again.', {
      stage,
      details,
      cause: error,
    });
  }
  if (status === 403) {
    return new OrderError('forbidden', 'You do not have access to that.', { stage, details, cause: error });
  }

  return new OrderError('server', `${context}.`, {
    stage,
    ...(status === undefined ? {} : { status }),
    details,
    cause: error,
  });
}
