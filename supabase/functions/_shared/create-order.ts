/**
 * `create-order` — the only trusted server-side business operation in V1.
 *
 * The order of operations is fixed by SPEC and every step is a trust boundary:
 *
 *   authenticate → validate → load cart → read current prices and stock →
 *   check stock → price → commit (one transaction) → email → respond
 *
 * Three properties are worth stating up front, because everything else follows
 * from them:
 *
 * - **The user comes from the verified session, never the body.** A
 *   client-supplied `userId` is stripped by the payload schema and, if one
 *   somehow arrived, nothing would read it.
 * - **The total comes from `products`, never the body.** Same reason.
 * - **Email is a side effect of a committed order, not a condition of one.**
 *   The mail attempt happens after the transaction and cannot change the
 *   response's success: a mail server outage returns `emailSent: false`, never
 *   a failure that implies the purchase did not happen.
 *
 * Every dependency arrives through {@link CreateOrderDeps}, so the whole
 * function is exercisable against a mocked store and a mocked transport, and
 * exactly one outcome event is logged per request.
 */

import { validatePayload, type CreateOrderPayloadSchema } from './checkout.ts';
import { jsonResponse, preflightResponse, readBearerToken, readRequestId } from './http.ts';
import { logger as defaultLogger, type Logger } from './logger.ts';
import type { Mailer, SendResult } from './mailgun.ts';
import { OrderError, toOrderError } from './order-error.ts';
import { evaluateCart } from './pricing.ts';
import type {
  CartEvaluation,
  CheckoutShipping,
  CommittedOrder,
  CreateOrderResult,
  InventoryShortfall,
  OrderStore,
} from './types.ts';

export interface CreateOrderDeps {
  store: OrderStore;
  /**
   * The confirmation transport, or `null` when Mailgun is not configured. A
   * missing configuration is a delivery failure, not a reason to refuse the
   * order, so it takes the same path as a rejected message.
   */
  mailer: Mailer | null;
  /** `createOrderPayloadSchema` from the frozen `src/schemas/checkout.ts`. */
  payloadSchema: CreateOrderPayloadSchema;
  /** Public origin of the storefront, used for the order link in the email. */
  appUrl: string | null;
  logger?: Logger;
  /** Injectable clock so `durationMs` is a fact rather than a coincidence. */
  now?: () => number;
}

interface PricedCart {
  cartId: string;
  evaluation: CartEvaluation;
}

export async function handleCreateOrder(
  request: Request,
  deps: CreateOrderDeps,
): Promise<Response> {
  // Rebound once the shipping address is known valid, so every later line in
  // this request carries the two facts an operator needs — who, and where to —
  // without any call site repeating them. See `docs/LOGGING.md`: an order id
  // and a city are enough to investigate; the rest of the address never is.
  let log = deps.logger ?? defaultLogger;
  const now = deps.now ?? (() => Date.now());
  const requestId = readRequestId(request);
  const startedAt = now();

  if (request.method === 'OPTIONS') return preflightResponse(request);
  if (request.method !== 'POST') {
    return fail(
      new OrderError('validation', 'This endpoint only accepts POST.', {
        status: 405,
        stage: 'method',
        details: { reason: 'method_not_allowed' },
      }),
      log,
      requestId,
      startedAt,
      now,
    );
  }

  try {
    const userId = await authenticate(request, deps.store);
    const body = await readJsonBody(request);
    const shipping = validateCheckout(body, deps.payloadSchema, log);
    log = log.child({ userId, city: shipping.city, country: shipping.country });

    const cart = await priceCart(userId, deps.store, log);

    log.info({
      event: 'order_create_started',
      requestId,
      scope: 'create-order',
      cartId: cart.cartId,
      itemCount: cart.evaluation.itemCount,
      totalKobo: cart.evaluation.totalKobo,
    });

    const order = await deps.store.commitOrder({ userId, cartId: cart.cartId, shipping });
    const emailSent = await sendConfirmation(order, shipping, deps, log, now, startedAt);

    log.info({
      event: 'order_created',
      requestId,
      scope: 'create-order',
      outcome: 'success',
      durationMs: now() - startedAt,
      orderId: order.id,
      reference: order.reference,
      itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
      totalKobo: order.totalKobo,
      emailSent,
    });

    const result: CreateOrderResult = {
      orderId: order.id,
      reference: order.reference,
      totalKobo: order.totalKobo,
      emailSent,
      order,
      items: order.items,
    };
    return jsonResponse(result, 200, requestId);
  } catch (error) {
    return fail(
      toOrderError(error, 'respond', 'The order could not be confirmed'),
      log,
      requestId,
      startedAt,
      now,
    );
  }
}

/* ===========================================================================
   Steps
   =========================================================================== */

async function authenticate(request: Request, store: OrderStore): Promise<string> {
  const token = readBearerToken(request);
  if (token === null) {
    throw new OrderError('unauthenticated', 'You need to sign in to place an order.', {
      stage: 'authenticate',
      details: { reason: 'missing_bearer_token' },
    });
  }
  try {
    return await store.resolveUserId(token);
  } catch (cause) {
    throw toOrderError(cause, 'authenticate', 'You need to sign in to place an order');
  }
}

/** A body that is not JSON is a client bug, not a server error. */
async function readJsonBody(request: Request): Promise<unknown> {
  let body: unknown;
  try {
    body = await request.json();
  } catch (cause) {
    throw new OrderError('validation', 'The checkout details could not be read.', {
      status: 400,
      stage: 'parse_body',
      details: { reason: 'malformed_json' },
      cause,
    });
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new OrderError('validation', 'The checkout details could not be read.', {
      status: 400,
      stage: 'parse_body',
      details: { reason: 'malformed_body' },
    });
  }
  return body;
}

function validateCheckout(
  body: unknown,
  schema: CreateOrderPayloadSchema,
  log: Logger,
): CheckoutShipping {
  const validation = validatePayload(schema, body);
  if (validation.ok) return validation.payload.shipping;

  // Field names only, never values: this line is about a customer who mistyped
  // their city, and their city is not the reader's business.
  log.error({
    event: 'checkout_validation_failed',
    scope: 'create-order',
    invalidFields: validation.fields,
  });
  throw new OrderError('validation', 'Some of the details you entered are not valid.', {
    stage: 'validate_payload',
    details: {
      reason: 'invalid_payload',
      fields: validation.fields,
      fieldErrors: validation.fieldErrors,
    },
  });
}

/** Load the user's active cart and price it from the current catalogue. */
async function priceCart(userId: string, store: OrderStore, log: Logger): Promise<PricedCart> {
  const cart = await store.loadActiveCart(userId);
  if (cart === null || cart.lines.length === 0) {
    throw new OrderError('validation', 'Your cart is empty.', {
      stage: 'load_cart',
      details: { reason: 'cart_empty' },
    });
  }

  const evaluation = evaluateCart(cart.lines);
  const shortfall = evaluation.shortfalls[0];
  if (shortfall !== undefined) {
    log.error({
      event: 'inventory_insufficient',
      scope: 'create-order',
      cartId: cart.id,
      productId: shortfall.productId,
      productName: shortfall.productName,
      requested: shortfall.requested,
      available: shortfall.available,
      shortfallCount: evaluation.shortfalls.length,
    });
    throw new OrderError('insufficient_inventory', shortageMessage(shortfall), {
      status: 409,
      stage: 'evaluate_cart',
      details: shortfallDetails(shortfall, evaluation.shortfalls.length),
    });
  }

  return { cartId: cart.id, evaluation };
}

function shortageMessage(shortfall: InventoryShortfall): string {
  return shortfall.available === 0
    ? `${shortfall.productName} has sold out. Remove it from your cart to continue.`
    : `Only ${shortfall.available} of ${shortfall.productName} left in stock.`;
}

/**
 * The facts the checkout UI needs to render the message. `product` is the slug
 * when the catalogue has one, so the UI can link to the product page.
 */
function shortfallDetails(
  shortfall: InventoryShortfall,
  shortfallCount: number,
): Record<string, unknown> {
  return {
    product: shortfall.slug ?? shortfall.productId,
    productId: shortfall.productId,
    productName: shortfall.productName,
    requested: shortfall.requested,
    available: shortfall.available,
    shortfallCount,
  };
}

/* ===========================================================================
   Email — a side effect, never a condition
   =========================================================================== */

async function sendConfirmation(
  order: CommittedOrder,
  shipping: CheckoutShipping,
  deps: CreateOrderDeps,
  log: Logger,
  now: () => number,
  requestStartedAt: number,
): Promise<boolean> {
  const startedAt = now();
  const outcome = await attemptConfirmation(order, shipping, deps);
  const durationMs = now() - startedAt;

  if (outcome.sent) {
    log.info({
      event: 'confirmation_email_sent',
      scope: 'create-order',
      orderId: order.id,
      reference: order.reference,
      durationMs,
    });
    return true;
  }

  // The most important line in the codebase. `orderPersisted: true` is on it so
  // nobody ever reads this as "the order failed".
  log.error({
    event: 'confirmation_email_failed',
    scope: 'create-order',
    orderId: order.id,
    reference: order.reference,
    durationMs,
    requestDurationMs: now() - requestStartedAt,
    orderPersisted: true,
    error: outcome.error,
  });
  return false;
}

async function attemptConfirmation(
  order: CommittedOrder,
  shipping: CheckoutShipping,
  deps: CreateOrderDeps,
): Promise<SendResult> {
  if (deps.mailer === null) {
    return {
      sent: false,
      error: new OrderError('configuration', 'The confirmation email could not be sent.', {
        details: { provider: 'mailgun', reason: 'mailgun_not_configured' },
      }),
    };
  }
  try {
    return await deps.mailer.send({ order, shipping, appUrl: deps.appUrl });
  } catch (cause) {
    // A transport that throws instead of returning is a bug in the transport.
    // The order is committed either way, so a thrower is a delivery failure,
    // not a request failure.
    return {
      sent: false,
      error: new OrderError('network', 'The confirmation email could not be sent.', { cause }),
    };
  }
}

/* ===========================================================================
   Failures — one `order_create_failed` line per request
   =========================================================================== */

function fail(
  error: OrderError,
  log: Logger,
  requestId: string | undefined,
  startedAt: number,
  now: () => number,
): Response {
  log.error({
    event: 'order_create_failed',
    requestId,
    scope: 'create-order',
    stage: error.stage ?? 'respond',
    durationMs: now() - startedAt,
    error,
  });
  return jsonResponse(error.toBody(), error.status, requestId);
}
