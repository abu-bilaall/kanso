/**
 * Structured logging for the Edge Function.
 *
 * There is no second implementation here. `createLogger` and `scrub` are the
 * browser's, imported from `src/lib/logger.ts`, because the redaction pattern
 * is the backstop that keeps credentials out of the log stream and a copy of it
 * would drift. What this module adds is the two things that are genuinely
 * edge-specific: the environment context, and a logger a test can read back.
 *
 * `docs/CONTRACT-REQUESTS.md` §9 asked for exactly this — until it was applied,
 * `scrub` was restated here line for line.
 */

import { createLogger, type LogFields, type Logger } from '../../../apps/web/src/lib/logger.ts';

export type {
  LogEvent,
  LogFields,
  Logger,
  LogLevel,
  LogLevelGate,
  LogSink,
} from '../../../apps/web/src/lib/logger.ts';
export { createLogger, REDACTED, scrub } from '../../../apps/web/src/lib/logger.ts';

/**
 * The slice of the Deno global this module needs, and `undefined` everywhere
 * else: the unit suite imports this module under Node, where there is no `Deno`
 * and no reason to pretend otherwise. `Reflect.get` rather than a property
 * access because `globalThis` has no index signature to narrow against.
 */
interface EdgeRuntime {
  env?: { get(name: string): string | undefined };
}

const EDGE_RUNTIME = Reflect.get(globalThis, 'Deno') as EdgeRuntime | undefined;

/**
 * Environment context, attached once so no call site has to remember it. The
 * browser logger does the same job for `runtime: 'browser'`; this is the edge
 * equivalent and no call site overrides it.
 */
function environmentContext(): LogFields {
  const env = EDGE_RUNTIME?.env;
  return {
    app: 'kanso-edge',
    env: env?.get('DENO_ENV') ?? env?.get('APP_ENV') ?? 'development',
    release: env?.get('DENO_DEPLOYMENT_ID') ?? 'local',
    function: 'create-order',
    userAgent: typeof navigator === 'undefined' ? undefined : navigator.userAgent,
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
