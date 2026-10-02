/**
 * The `create-order` client.
 *
 * Checkout's only network call that is not a read. Everything it sends is
 * fulfilment data: the payload is built through `createOrderPayloadSchema`,
 * which strips unknown keys, so there is nowhere in this file to put a price, a
 * total, a user id or an inventory count even by accident. The authoritative
 * total comes back in the response and is never computed here.
 *
 * ## Error mapping
 *
 * `create-order` is being written in parallel with this UI and its error envelope
 * is not yet a frozen contract, so {@link toCreateOrderError} reads a small
 * family of shapes rather than one: `{ error: { code, message } }` and a flat
 * `{ code, message }` are both accepted, and the code is trusted only when it is
 * one of `APP_ERROR_CODES`. Everything else degrades to a readable `AppError` —
 * never a stack trace, never silence.
 *
 * `insufficient_inventory` is the case that matters. SPEC requires the server to
 * name the product and the available count, and this layer is forbidden from
 * flattening that into "something went wrong": the server's own sentence is
 * passed through verbatim.
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
  // A2 sends `{ error: { … } }`; a bare `{ code, message }` is accepted too, so a
  // future envelope change degrades to a readable message rather than a generic one.
  const inner = asRecord(envelope?.error) ?? envelope;
  const code = readCode(inner?.code);
  const message = typeof inner?.message === 'string' ? inner.message : undefined;

  if (code === 'insufficient_inventory') {
    const productId = inner?.productId ?? inner?.product_id;
    const available = inner?.available;
    return new InsufficientInventoryError(
      message ?? 'Some of those quantities are no longer available.',
      {
        status,
        productId: typeof productId === 'string' ? productId : undefined,
        available: typeof available === 'number' ? available : undefined,
      },
    );
  }

  if (code !== null) return new AppError(code, message, { status });

  if (status === 401 || status === 403) {
    return new AppError(
      'unauthenticated',
      message ?? 'Your session has ended. Sign in again to place your order.',
      { status },
    );
  }

  if (status === 429) {
    return new AppError(
      'rate_limited',
      message ?? 'Too many attempts. Wait a moment and try again.',
      {
        status,
      },
    );
  }

  if (status !== undefined && status >= 500) {
    return new AppError(
      'server',
      message ?? 'Kanso could not reach the order service. Try again shortly.',
      {
        status,
      },
    );
  }

  return new AppError(
    'unknown',
    message ?? 'The order could not be placed. Nothing has been charged.',
    {
      status,
    },
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
 *         the server reports a stock shortfall, carrying its message and count.
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
      details: { fieldCount: Object.keys(asRecord(data) ?? {}).length },
    });
  }

  return result.data;
}
