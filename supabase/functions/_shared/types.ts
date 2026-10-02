/**
 * Domain types shared by the `create-order` Edge Function.
 *
 * These mirror `docs/CONTRACTS.md` and `src/schemas/checkout.ts`. They are
 * declared here rather than imported because the frozen `tsconfig.app.json`
 * rejects the `.ts` extension imports the Deno runtime requires — see the
 * `create_order_payload_contract` entry in `docs/CONTRACT-REQUESTS.md`. The Zod
 * schema itself is *not* duplicated: it is injected into the handler, so the
 * browser and the Edge Function still validate against one source of truth.
 */

/* ===========================================================================
   Checkout
   =========================================================================== */

/**
 * The seven fulfilment fields, post-validation. `addressLine2` is `undefined`
 * rather than `''` when the customer left it blank, which is what the database
 * wants (NULL, not an empty string).
 */
export interface CheckoutShipping {
  fullName: string;
  email: string;
  phone: string;
  addressLine1: string;
  addressLine2?: string | undefined;
  city: string;
  state: string;
  country: string;
}

/** The body posted to this function. Nothing else is read from it. */
export interface CreateOrderPayload {
  shipping: CheckoutShipping;
}

/* ===========================================================================
   Cart
   =========================================================================== */

/** One cart line joined to the product's *current* catalogue row. */
export interface CartLine {
  productId: string;
  /** `null` once a product has left the catalogue. Present for the error copy. */
  slug: string | null;
  productName: string;
  quantity: number;
  /** Integer kobo, read from `products` at request time. Never from the client. */
  unitPriceKobo: number;
  /** Units currently available, read from `products` at request time. */
  inventory: number;
}

export interface ActiveCart {
  id: string;
  lines: CartLine[];
}

export interface PricedLine extends CartLine {
  lineTotalKobo: number;
}

/** A line the customer wants more of than the catalogue can supply. */
export interface InventoryShortfall {
  productId: string;
  slug: string | null;
  productName: string;
  requested: number;
  available: number;
}

export interface CartEvaluation {
  lines: PricedLine[];
  /** Units, not lines. `addItem(p, 3)` is 3. */
  itemCount: number;
  /** The authoritative order total in integer kobo. */
  totalKobo: number;
  shortfalls: InventoryShortfall[];
}

/* ===========================================================================
   The store port
   ===========================================================================
   The three operations this function is allowed to perform. Each is a trust
   boundary, which is why the whole commit is one call rather than four: see
   `docs/CONTRACT-REQUESTS.md` for the `create_order_atomic` signature this
   port is written against.
   =========================================================================== */

export interface CommitOrderInput {
  /** Always the id resolved from the caller's JWT, never the request body. */
  userId: string;
  cartId: string;
  shipping: CheckoutShipping;
}

export interface CommittedOrderItem {
  productId: string;
  productName: string;
  quantity: number;
  /** Snapshot of the price at purchase time, in integer kobo. */
  unitPriceKobo: number;
}

export interface CommittedOrder {
  id: string;
  reference: string;
  status: string;
  subtotalKobo: number;
  totalKobo: number;
  createdAt: string;
  items: CommittedOrderItem[];
}

/**
 * The whole persistence surface of order creation.
 *
 * `commitOrder` is deliberately a single method. The four writes it stands for
 * — insert the order, insert its items, close the cart, decrement inventory —
 * have to be one transaction or a failure leaves a half-order behind, and the
 * only atomic mechanism available to a PostgREST client is a Postgres function.
 */
export interface OrderStore {
  /** Verify an access token and return the user id behind it. */
  resolveUserId(accessToken: string): Promise<string>;
  /** The user's active cart, joined to current product prices and inventory. */
  loadActiveCart(userId: string): Promise<ActiveCart | null>;
  /** Create the order, its items, close the cart and decrement stock. Atomic. */
  commitOrder(input: CommitOrderInput): Promise<CommittedOrder>;
}

/* ===========================================================================
   Wire shapes
   =========================================================================== */

/** The `200` body. The first four keys are the frozen `createOrderResultSchema`. */
export interface CreateOrderResult {
  orderId: string;
  reference: string;
  totalKobo: number;
  emailSent: boolean;
  order: CommittedOrder;
  items: CommittedOrderItem[];
}
