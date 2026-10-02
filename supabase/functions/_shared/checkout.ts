/**
 * Checkout payload validation.
 *
 * This is a trust boundary, so the payload is validated again here even though
 * the browser already validated it with the same schema — a client is free to
 * skip that step. The schema is **injected** rather than imported: it is
 * `createOrderPayloadSchema` from the frozen `src/schemas/checkout.ts`, owned by
 * Foundation, and the Deno runtime and the frozen `tsconfig.app.json` cannot
 * both resolve that path. See `docs/CONTRACT-REQUESTS.md`.
 *
 * Note what the schema does for us: it *strips* unknown keys, so a hostile
 * client sending `userId` or `totalKobo` gets a payload that does not contain
 * them. There is nowhere on the wire to be fooled.
 */

import type { CreateOrderPayload } from './types.js';

/**
 * The frozen `createOrderPayloadSchema`, passed in by the entrypoint. Declared
 * as the narrow thing this module needs — "something that can validate a
 * payload" — rather than as Zod's own types, so the browser's schema satisfies
 * it without the two runtimes having to agree on Zod's input/output variance.
 */
export interface CreateOrderPayloadSchema {
  safeParse(input: unknown): PayloadParseResult;
}

export type PayloadParseResult =
  | { success: true; data: CreateOrderPayload }
  | { success: false; error: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> } };

export const FORM_ERROR_KEY = 'form';

export type PayloadValidation =
  | { ok: true; payload: CreateOrderPayload }
  | { ok: false; fieldErrors: Record<string, string>; fields: string[] };

/**
 * Validate an untrusted request body.
 *
 * Field names are reported without the `shipping.` prefix so checkout can key
 * its errors straight off the form controls, and never with a value attached.
 */
export function validatePayload(
  schema: CreateOrderPayloadSchema,
  input: unknown,
): PayloadValidation {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, payload: result.data };

  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = controlName(issue.path);
    if (fieldErrors[key] === undefined) fieldErrors[key] = issue.message;
  }
  return { ok: false, fieldErrors, fields: Object.keys(fieldErrors) };
}

/**
 * `['shipping', 'city']` -> `'city'`, `['shipping']` -> `form`.
 *
 * The wire nests the address under `shipping`; the form does not, and the
 * messages are for the form.
 */
function controlName(path: ReadonlyArray<PropertyKey>): string {
  if (path.length === 0) return FORM_ERROR_KEY;
  const first = path[0];
  if (first !== 'shipping') return String(path[0] ?? FORM_ERROR_KEY);
  const rest = path.slice(1);
  return rest.length === 0 ? FORM_ERROR_KEY : String(rest[0] ?? FORM_ERROR_KEY);
}
