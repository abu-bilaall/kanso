/**
 * Structured logging for the Edge Function.
 *
 * Implements `docs/LOGGING.md` exactly — same API, same event vocabulary, same
 * two levels, same rule that environment context is attached once and centrally
 * — and emits the six events reserved for A2 in that document.
 *
 * `scrub` is a faithful port of the one in `src/lib/logger.ts` rather than an
 * import of it: the Deno runtime requires `.ts` extensions on relative imports
 * and the frozen `tsconfig.app.json` rejects them, so the shared module is not
 * reachable from both runtimes. Reusing the *pattern* is the point — a
 * redaction backstop that drifts from the browser's is worse than none.
 * `docs/CONTRACT-REQUESTS.md` asks for the one-line change that lets the two
 * share a single implementation.
 */

/** The only two levels. Anything more precise belongs in a field. */
export type LogLevel = 'info' | 'error';

export type LogLevelGate = LogLevel | 'silent';

/** Structured, JSON-serialisable payload. Never a free-text sentence. */
export type LogFields = Record<string, unknown>;

export interface LogEvent extends LogFields {
  /** Canonical snake_case name from `docs/LOGGING.md`. */
  event: string;
  outcome?: 'success' | 'failure';
  durationMs?: number;
  /** Flattened to `{ name, message, code?, status?, details? }` before emission. */
  error?: unknown;
}

export interface Logger {
  info(event: LogEvent): void;
  error(event: LogEvent): void;
  setContext(fields: LogFields): void;
  child(fields: LogFields): Logger;
  setLevel(level: LogLevelGate): void;
  readonly level: LogLevelGate;
}

/**
 * Key names that must never reach a log line, matched case-insensitively as a
 * substring so `accessToken`, `MAILGUN_API_KEY` and `userPassword` are all
 * caught. A backstop, not permission: it cannot see `orderNote: 'card 4111…'`.
 */
const SENSITIVE_KEY_PATTERN =
  /(password|passwd|secret|token|api[-_]?key|authorization|auth[-_]?header|cookie|credential|service[-_]?role|refresh[-_]?token|otp|pin)/i;

export const REDACTED = '[redacted]';

const MAX_DEPTH = 4;
const MAX_ARRAY_ITEMS = 50;

export function scrub(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return undefined;
  if (depth > MAX_DEPTH) return '[depth-limit]';

  if (value instanceof Error) return scrubError(value, depth);

  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') return value;
  if (type === 'bigint') return String(value);
  if (type === 'function' || type === 'symbol') return undefined;

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => scrub(item, depth + 1));
  }

  if (value instanceof Date) return value.toISOString();

  if (type === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : scrub(item, depth + 1);
    }
    return output;
  }

  return undefined;
}

/**
 * Flatten a throwable to the four facts a reader needs. `cause` is deliberately
 * not walked: it is a chain, not a fact, and the deepest link is usually the
 * one carrying a credential.
 */
function scrubError(error: Error, depth: number): Record<string, unknown> {
  const flattened: Record<string, unknown> = { name: error.name, message: error.message };
  if ('code' in error) flattened.code = scrub(error.code, depth + 1);
  if ('status' in error) flattened.status = scrub(error.status, depth + 1);
  if ('details' in error) flattened.details = scrub(error.details, depth + 1);
  return flattened;
}

/**
 * Environment context, attached once so no call site has to remember it. The
 * browser logger does the same job for `runtime: 'browser'`; this is the edge
 * equivalent and no call site overrides it.
 */
function environmentContext(): LogFields {
  return {
    app: 'kanso-edge',
    runtime: 'edge',
    env: readEnv('DENO_ENV') ?? readEnv('APP_ENV') ?? 'development',
    release: readEnv('DENO_DEPLOYMENT_ID') ?? 'local',
    function: 'create-order',
    userAgent: typeof navigator === 'undefined' ? undefined : navigator.userAgent,
  };
}

/**
 * The slice of the Deno global this module needs, and `undefined` everywhere
 * else: the unit suite runs this module under Node, where there is no `Deno`
 * and no reason to pretend otherwise. `Reflect.get` rather than a property
 * access because `globalThis` has no index signature to narrow against.
 */
interface EdgeRuntime {
  env?: { get(name: string): string | undefined };
}

const EDGE_RUNTIME = Reflect.get(globalThis, 'Deno') as EdgeRuntime | undefined;

function readEnv(key: string): string | undefined {
  return EDGE_RUNTIME?.env?.get(key);
}

/** Where a finished log line goes. Production writes to the console. */
export type LogSink = (level: LogLevel, line: string) => void;

function consoleSink(level: LogLevel, line: string): void {
  if (level === 'error') {
    console.error(line);
  } else {
    console.info(line);
  }
}

export function createLogger(
  base: LogFields,
  level: LogLevelGate,
  sink: LogSink = consoleSink,
): Logger {
  const write = (logLevel: LogLevel, event: LogEvent): void => {
    if (level === 'silent') return;
    if (level === 'error' && logLevel === 'info') return;

    const { error, ...rest } = event;
    const flattened = scrub({
      ...base,
      ...rest,
      level: logLevel,
      timestamp: new Date().toISOString(),
      ...(error === undefined ? {} : { error: scrub(error) }),
    });

    // One JSON object per line, to stdout/stderr where the runtime collects it.
    sink(logLevel, JSON.stringify(flattened));
  };

  return {
    info: (event) => write('info', event),
    error: (event) => write('error', { outcome: 'failure', ...event }),
    setContext: (fields) => Object.assign(base, scrub(fields) as LogFields),
    child: (fields) => createLogger({ ...base, ...(scrub(fields) as LogFields) }, level, sink),
    setLevel: (next) => {
      level = next;
    },
    get level() {
      return level;
    },
  };
}

/** The one edge logger. Import it; `handleCreateOrder` defaults to it. */
export const logger: Logger = createLogger(environmentContext(), 'info');

/**
 * A logger that keeps every serialised line instead of printing it, so a test
 * can assert on exactly what the log stream would have received — timestamp,
 * environment context, redactions and all.
 */
export function createCapturingLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  return { logger: createLogger({}, 'info', (_level, line) => lines.push(line)), lines };
}
