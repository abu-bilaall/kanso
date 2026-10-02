/**
 * Structured logging.
 *
 * Implements the conventions settled in `docs/LOGGING.md`, which came from the
 * `logging-best-practices` skill run once during Phase 1. The short version:
 *
 *   1. ONE wide, context-rich event per operation — never a scatter of one-line
 *      `console.log`s describing the steps taken to get there.
 *   2. Structured fields only. Every line is a JSON object. No free text.
 *   3. Two levels: `info` and `error`. Nothing else.
 *   4. High-cardinality identifiers (`sessionId`, `userId`, `orderId`) and business
 *      context (`itemCount`, `subtotalKobo`, `outcome`) travel with every event,
 *      because "a customer could not check out" is only diagnosable with them.
 *   5. Environment context is attached once, centrally, by this module — never
 *      sprinkled through call sites.
 *   6. Nothing sensitive is ever logged. {@link scrub} is applied to every line
 *      as a backstop; callers are still expected to pass structured, minimal
 *      fields rather than raw payloads.
 *
 * There is exactly one logger instance in the codebase. Import it.
 */

import { AppError } from './errors';

/** The only two levels. Anything more precise belongs in a field. */
export type LogLevel = 'info' | 'error';

/** Structured, JSON-serialisable payload. Never a free-text sentence. */
export type LogFields = Record<string, unknown>;

/**
 * A single wide event.
 *
 * `event` is the canonical, snake_case, past-tense name from the vocabulary in
 * `docs/LOGGING.md` — `catalogue_loaded`, `cart_update_failed`,
 * `order_created`. A stable event name is what makes logs queryable; inventing a
 * new one mid-project is how log search dies.
 */
export interface LogEvent extends LogFields {
  event: string;
  /** Present on `error` lines and, where meaningful, on `info` lines. */
  outcome?: 'success' | 'failure';
  /** Wall-clock cost of the operation, when the caller measured it. */
  durationMs?: number;
  /** An `Error`, `AppError` or anything throwable. Flattened before emission. */
  error?: unknown;
}

export type LogLevelGate = LogLevel | 'silent';

export interface Logger {
  /** A completed operation, successful or not. */
  info(event: LogEvent): void;
  /** An operation that failed. Carries `error` and `outcome: 'failure'`. */
  error(event: LogEvent): void;
  /** Add fields to every subsequent line from this logger. Mutates in place. */
  setContext(fields: LogFields): void;
  /** A logger that merges `fields` under everything this one already carries. */
  child(fields: LogFields): Logger;
  /** Raise or lower the gate. Defaults to `info`. */
  setLevel(level: LogLevelGate): void;
  readonly level: LogLevelGate;
}

/**
 * Field names that must never reach a log line. Matched case-insensitively as a
 * substring, so `accessToken`, `MAILGUN_API_KEY` and `userPassword` are all
 * caught. Values are replaced with `'[redacted]'`; the key survives so a reader
 * can see that something *was* there.
 */
const SENSITIVE_KEY_PATTERN =
  /(password|passwd|secret|token|api[-_]?key|authorization|auth[-_]?header|cookie|credential|service[-_]?role|refresh[-_]?token|otp|pin)/i;

export const REDACTED = '[redacted]';

/**
 * Recursively redact sensitive keys and drop anything not JSON-serialisable.
 * Depth-limited so a cyclic or pathological object cannot hang the browser.
 */
export function scrub(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return undefined;
  if (depth > 4) return '[depth-limit]';

  if (value instanceof Error || AppError.is(value)) {
    const error = value as Error & { code?: unknown; status?: unknown; details?: unknown };
    return {
      name: error.name,
      message: error.message,
      ...(error.code === undefined ? {} : { code: error.code }),
      ...(error.status === undefined ? {} : { status: error.status }),
      ...(error.details === undefined ? {} : { details: scrub(error.details, depth + 1) }),
    };
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => scrub(item, depth + 1));
  }

  if (value instanceof Date) return value.toISOString();

  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : scrub(item, depth + 1);
    }
    return output;
  }

  return undefined;
}

/**
 * Environment characteristics, attached to every line by this module so no call
 * site has to remember them. High cardinality and high dimensionality are the
 * point: a line without them cannot be tied to a build or a browser.
 */
function environmentContext(): LogFields {
  const importMeta = import.meta.env as Record<string, unknown> | undefined;
  return {
    app: 'kanso-web',
    runtime: 'browser',
    env: importMeta?.MODE ?? 'development',
    release: importMeta?.VITE_RELEASE ?? 'local',
    userAgent: typeof navigator === 'undefined' ? undefined : navigator.userAgent,
  };
}

function createLogger(base: LogFields, level: LogLevelGate): Logger {
  const write = (logLevel: LogLevel, event: LogEvent): void => {
    if (level === 'silent') return;
    if (level === 'error' && logLevel === 'info') return;
    if (level === 'info' && logLevel === 'error') return;

    const { error, ...rest } = event;
    const flattened = scrub({
      ...base,
      ...rest,
      level: logLevel,
      timestamp: new Date().toISOString(),
      ...(error === undefined ? {} : { error: scrub(error) }),
    });

    // One JSON object per line. Never a stringified sentence.
    const line = JSON.stringify(flattened);
    if (logLevel === 'error') {
      console.error(line);
    } else {
      console.info(line);
    }
  };

  return {
    info: (event) => write('info', event),
    error: (event) => write('error', { outcome: 'failure', ...event }),
    setContext: (fields) => Object.assign(base, scrub(fields) as LogFields),
    child: (fields) => createLogger({ ...base, ...(scrub(fields) as LogFields) }, level),
    setLevel: (next) => {
      level = next;
    },
    get level() {
      return level;
    },
  };
}

/**
 * The one logger. Import it from here; do not construct your own.
 *
 * `logger.child({ sessionId })` inside `AuthProvider` gives every downstream
 * request a correlated identifier, which is the whole point of wide events.
 */
export const logger: Logger = createLogger(environmentContext(), 'info');

/**
 * Reset to defaults. Tests only — it exists so a suite can assert on emitted
 * lines without leaking context into the next test.
 */
export function resetLoggerForTests(level: LogLevelGate = 'silent'): void {
  logger.setLevel(level);
}
