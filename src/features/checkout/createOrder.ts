/**
 * The `create-order` client.
 *
 * Checkout's only network call that is not a read. Everything it sends is
 * fulfilment data: the payload is built through `createOrderPayloadSchema`,
 * which strips unknown keys, so there is nowhere in this file to put a price, a
 * total, a user id or an inventory count even by accident. The authoritative
 * total comes back in the response and is never computed here.
 *
 * ## The wire contract
 *
 * Both halves are documented in `supabase/functions/create-order/README.md`, and
 * this file is written to that document rather than to a guess:
 *
 * ```jsonc
 * // 200 — `createOrderResultSchema`. `order` and `items` also come back; the
 * // frozen schema strips them, and `useOrder` reads the durable record anyway.
 * { "orderId": "…", "reference": "KS-8902-DX", "totalKobo": 1990000, "emailSent": true }
 *
 * // failure — the shape `AppError` serialises to: FLAT, not nested.
 * { "code": "insufficient_inventory",
 *   "message": "Only 2 of Oak Pen Cup left in stock.",
 *   "retryable": false,
 *   "details": { "product": "oak-pen-cup", "productId": "…", "productName": "Oak Pen Cup",
 *                "requested": 3, "available": 2, "shortfallCount": 1 } }
 * ```
 *
 * ## Why the mapping is careful
 *
 * - `code` is trusted only when it is in `APP_ERROR_CODES`. An unknown code
 *   degrades to a readable `AppError` rather than being passed through.
 * - `details.available` and `details.productId` are read from `details`, which is
 *   where the function puts them — reading them off the top level would silently
 *   produce `undefined` and lose the count the customer needs.
 * - `retryable` comes from the server when it is present, so a 409 is not
 *   offered a "Try again" that will fail identically and a 500 is not left
 *   unretryable.
 * - `details.fieldErrors` (a `422`) is carried through so the form can render
 *   the server's own per-field messages.
 * - A `{ error: { … } }` envelope is still accepted, because the cost of being
 *   wrong is a generic message and the cost of not accepting it is worse.
 *
 * `insufficient_inventory` is the case that matters. SPEC requires the server to
 * name the product and the available count, and this layer is forbidden from
 * flattening that into "something went wrong" — the server's own sentence reaches
 * the customer verbatim.
 */

import {
  APP_ERROR_CODES,
  AppError,
  type AppErrorCode,
  InsufficientInventoryError,
} from '@/lib/errors';
import { getSupabaseClient } from '@/lib/supabase';
import {
  type Address,
  type CreateOrderResult,
  createOrderPayloadSchema,
  createOrderResultSchema,
  type FieldErrors,
} from '@/schemas';

/** The Edge Function's name, in one place. */
export const CREATE_ORDER_FUNCTION = 'create-order';

/** Narrow an unknown to a plain object without trusting its shape. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Pull the error body out of whatever `functions.invoke` handed back.
 *
 * `FunctionsHttpError.context` is the raw `Response`, which has to be read
 * before it is usable; `FunctionsRelayError` and `FunctionsFetchError` carry a
 * parsed object instead. Both are handled, and a body that cannot be read at all
 * degrades to `null` rather than throwing out of an error path.
 */
async function readErrorBody(error: unknown): Promise<unknown> {
  const context = asRecord(error)?.context;
  if (context === undefined || context === null) return null;

  if (typeof Response !== 'undefined' && context instanceof Response) {
    try {
      return await context.clone().json();
    } catch {
      return null;
    }
  }

  return context;
}

/** The status code, when the error carries a real HTTP response. */
function readStatus(error: unknown): number | undefined {
  const context = asRecord(error)?.context;
  if (typeof Response !== 'undefined' && context instanceof Response) return context.status;
  const direct = asRecord(error)?.status;
  return typeof direct === 'number' ? direct : undefined;
}

/** Trust a code only when it is one the app already knows how to render. */
function readCode(value: unknown): AppErrorCode | null {
  if (typeof value !== 'string') return null;
  return (APP_ERROR_CODES as readonly string[]).includes(value) ? (value as AppErrorCode) : null;
}

/**
 * Per-field messages from a `422`, in the `field -> message` shape
 * {@link CheckoutForm} renders. Anything that is not a string→string map is
 * ignored, so a malformed `details` cannot put `[object Object]` on a screen.
 */
function readFieldErrors(details: Record<string, unknown> | null): FieldErrors | undefined {
  if (details === null) return undefined;
  const raw = asRecord(details.fieldErrors);
  if (raw === null) return undefined;

  const errors: FieldErrors = {};
  for (const [field, message] of Object.entries(raw)) {
    if (typeof message === 'string' && message.length > 0) errors[field] = message;
  }
  return Object.keys(errors).length === 0 ? undefined : errors;
}

/**
 * Turn a `create-order` failure into the {@link AppError} the UI renders.
 *
 * Exported for the unit suite: the mapping from a server envelope to a customer
 * sentence is the part of checkout that must not drift, and it is the part with
 * no interface to click through.
 *
 * @param body   The parsed error body, or `null` when it could not be read.
 * @param status HTTP status, when there was one.
 */
export function toCreateOrderError(body: unknown, status?: number): AppError {
  const envelope = asRecord(body);
  // The documented envelope is flat. A nested `{ error: { … } }` is accepted as
  // a fallback so an envelope change costs a generic message rather than a crash.
  const inner =
    (envelope !== null && readCode(envelope.code) !== null ? envelope : null) ??
    asRecord(envelope?.error) ??
    envelope;
  const details = asRecord(inner?.details);

  const code = readCode(inner?.code);
  const message = typeof inner?.message === 'string' ? inner.message : undefined;
  const retryable = typeof inner?.retryable === 'boolean' ? inner.retryable : undefined;
  const fieldErrors = readFieldErrors(details);
  const carried: Record<string, unknown> = {
    ...(details === null ? {} : { details }),
    ...(fieldErrors === undefined ? {} : { fieldErrors }),
  };
  const options = {
    status,
    ...(retryable === undefined ? {} : { retryable }),
    ...(Object.keys(carried).length === 0 ? {} : { details: carried }),
  };

  if (code === 'insufficient_inventory') {
    const productId = details?.productId ?? inner?.productId;
    const available = details?.available ?? inner?.available;
    return new InsufficientInventoryError(
      message ?? 'Some of those quantities are no longer available.',
      {
        ...options,
        productId: typeof productId === 'string' ? productId : undefined,
        available: typeof available === 'number' ? available : undefined,
      },
    );
  }

  if (code !== null) return new AppError(code, message, options);

  if (status === 401 || status === 403) {
    return new AppError(
      'unauthenticated',
      message ?? 'Your session has ended. Sign in again to place your order.',
      options,
    );
  }

  if (status === 429) {
    return new AppError(
      'rate_limited',
      message ?? 'Too many attempts. Wait a moment and try again.',
      options,
    );
  }

  if (status !== undefined && status >= 500) {
    return new AppError(
      'server',
      message ?? 'Kanso could not reach the order service. Try again shortly.',
      options,
    );
  }

  return new AppError(
    'unknown',
    message ?? 'The order could not be placed. Nothing has been charged.',
    options,
  );
}

/** The whole failure path for one `functions.invoke` error, assembled. Never throws. */
export async function toCreateOrderErrorFrom(error: unknown): Promise<AppError> {
  return toCreateOrderError(await readErrorBody(error), readStatus(error));
}

/**
 * Place an order for the signed-in user's active cart.
 *
 * @throws {AppError} every failure, normalised. `InsufficientInventoryError` when
 *         the server reports a stock shortfall, carrying its message, product and
 *         available count; a `validation` error carries `fieldErrors` when the
 *         server sent per-field messages.
 */
export async function createOrder(shipping: Address): Promise<CreateOrderResult> {
  // The schema is the wire contract. Parsing rather than spreading the object is
  // what guarantees the payload cannot carry a client-supplied price or total.
  const body = createOrderPayloadSchema.parse({ shipping });

  const { data, error } = await getSupabaseClient().functions.invoke<unknown>(
    CREATE_ORDER_FUNCTION,
    { body },
  );

  if (error) throw await toCreateOrderErrorFrom(error);

  const result = createOrderResultSchema.safeParse(data);
  if (!result.success) {
    // A 200 whose body we cannot read is not a confirmed order. Say so, rather
    // than navigating to a confirmation page built from a shape we invented.
    throw new AppError('server', 'The order service replied in a format we cannot read.', {
      status: 200,
      retryable: true,
    });
  }

  return result.data;
}
