/**
 * The Supabase implementation of the {@link OrderStore} port.
 *
 * The port itself lives in `./types.ts` and imports nothing, so the unit suite
 * can exercise order creation without a database, a network or `supabase-js`.
 * This file is the only place that knows PostgREST exists, and it is imported
 * solely by the Deno entrypoint.
 *
 * ## Why one call commits an order
 *
 * Creating an order is four writes — the order, its items, closing the cart,
 * decrementing stock — and they have to be one transaction or a failure leaves
 * a half-order behind. A PostgREST client cannot open a transaction, so the
 * only atomic mechanism available is a Postgres function. `create_order_atomic`
 * re-reads the cart, re-prices it from `products`, checks stock, writes
 * everything and returns the result; nothing here computes a price.
 *
 * Every row that crosses the wire is parsed with Zod before a single field is
 * read. A column A1 named differently surfaces as one error naming the column,
 * not as an `undefined` silently becoming a zero on an order. The exact RPC
 * signature and body this file is written against are in
 * `docs/CONTRACT-REQUESTS.md`.
 */

import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { OrderError } from './order-error.ts';
import type {
  ActiveCart,
  CartLine,
  CommitOrderInput,
  CommittedOrder,
  CommittedOrderItem,
  OrderStore,
} from './types.ts';

export interface SupabaseStoreConfig {
  url: string;
  /** Server-side only. Never a `VITE_` variable, never in the browser bundle. */
  serviceRoleKey: string;
}

/* ===========================================================================
   Wire shapes
   =========================================================================== */

const productRow = z.object({
  id: z.string().min(1),
  slug: z.string().nullish(),
  name: z.string().min(1),
  price_kobo: z.number().int().nonnegative(),
  inventory: z.number().int().nonnegative(),
});

const cartRow = z.object({
  id: z.string().min(1),
  cart_items: z.array(z.object({ quantity: z.number().int(), products: productRow.nullable() })),
});

const committedOrderRow = z.object({
  id: z.string().min(1),
  reference: z.string().min(1),
  status: z.string().min(1),
  subtotal_kobo: z.number().int().nonnegative(),
  total_kobo: z.number().int().nonnegative(),
  created_at: z.string().min(1),
});

const committedItemRow = z.object({
  product_id: z.string().min(1),
  product_name: z.string().min(1),
  quantity: z.number().int().positive(),
  unit_price_kobo: z.number().int().nonnegative(),
});

const commitOutcome = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), order: committedOrderRow, items: z.array(committedItemRow) }),
  z.looseObject({ ok: z.literal(false), code: z.string().min(1) }),
]);

/* ===========================================================================
   Store
   =========================================================================== */

export function createSupabaseOrderStore(config: SupabaseStoreConfig): OrderStore {
  // The service role bypasses RLS, which is the point: the browser must never
  // be able to write an order, but this function is the trusted path and has
  // already resolved the user from a verified JWT.
  const client = createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return {
    async resolveUserId(accessToken: string): Promise<string> {
      const { data, error } = await client.auth.getUser(accessToken);
      if (error !== null || data.user === null) {
        throw new OrderError('unauthenticated', 'You need to sign in to place an order.', {
          details: { reason: error === null ? 'no_user' : 'invalid_token' },
        });
      }
      return data.user.id;
    },

    async loadActiveCart(userId: string): Promise<ActiveCart | null> {
      const { data, error } = await client
        .from('carts')
        .select('id, cart_items(quantity, products(id, slug, name, price_kobo, inventory))')
        .eq('user_id', userId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error !== null) {
        throw new OrderError('server', 'We could not read your cart.', {
          details: databaseDetails(error),
        });
      }
      if (data === null) return null;

      const cart = parseOrThrow(cartRow, data, 'cart');
      const lines: CartLine[] = cart.cart_items.flatMap((item) =>
        item.products === null
          ? []
          : [
              {
                productId: item.products.id,
                slug: item.products.slug ?? null,
                productName: item.products.name,
                quantity: item.quantity,
                unitPriceKobo: item.products.price_kobo,
                inventory: item.products.inventory,
              },
            ],
      );
      return { id: cart.id, lines };
    },

    async commitOrder(input: CommitOrderInput): Promise<CommittedOrder> {
      const { data, error } = await client.rpc('create_order_atomic', {
        p_user_id: input.userId,
        p_cart_id: input.cartId,
        p_shipping: input.shipping,
      });

      if (error !== null) throw commitFailure(error);

      const outcome = parseOrThrow(commitOutcome, data, 'commit');
      if (!outcome.ok) throw commitRejection(outcome);

      const items: CommittedOrderItem[] = outcome.items.map((item) => ({
        productId: item.product_id,
        productName: item.product_name,
        quantity: item.quantity,
        unitPriceKobo: item.unit_price_kobo,
      }));

      return {
        id: outcome.order.id,
        reference: outcome.order.reference,
        status: outcome.order.status,
        subtotalKobo: outcome.order.subtotal_kobo,
        totalKobo: outcome.order.total_kobo,
        createdAt: outcome.order.created_at,
        items,
      };
    },
  };
}

/* ===========================================================================
   Failure mapping
   =========================================================================== */

interface DatabaseError {
  code?: unknown;
  message?: unknown;
  hint?: unknown;
  details?: unknown;
}

/**
 * `create_order_atomic` returns a structured rejection rather than raising, so
 * a customer-caused failure never has to be recovered from an error string.
 */
function commitRejection(outcome: { code: string } & Record<string, unknown>): OrderError {
  const details: Record<string, unknown> = { reason: outcome.code };
  for (const key of ['productId', 'productName', 'slug', 'requested', 'available']) {
    const value = outcome[key];
    if (value !== undefined && value !== null) details[key] = value;
  }

  if (outcome.code === 'insufficient_inventory') {
    return new OrderError('insufficient_inventory', insufficientInventoryMessage(details), {
      status: 409,
      details,
    });
  }
  if (outcome.code === 'cart_not_active' || outcome.code === 'cart_empty') {
    return new OrderError(
      'validation',
      'Your cart is no longer available. Refresh and try again.',
      {
        details,
      },
    );
  }
  return new OrderError('server', 'The order could not be confirmed.', { details });
}

function insufficientInventoryMessage(details: Record<string, unknown>): string {
  const name = details.productName;
  const available = details.available;
  if (typeof name !== 'string' || typeof available !== 'number') {
    return 'Some items are no longer available in that quantity.';
  }
  return available === 0
    ? `${name} has sold out. Remove it from your cart to continue.`
    : `Only ${available} of ${name} left in stock.`;
}

/**
 * A genuine database error. The only one worth special-casing is the race where
 * stock vanished between the pre-check and the conditional decrement: the
 * transaction rolled back, so nothing was written, and the customer gets the
 * same answer they would have had we checked a moment later.
 */
function commitFailure(error: DatabaseError): OrderError {
  const details = databaseDetails(error);
  const message = typeof error.message === 'string' ? error.message : '';
  if (error.code === 'P0001' && message.startsWith('inventory_race')) {
    return new OrderError('insufficient_inventory', 'Stock changed while you were checking out.', {
      status: 409,
      details: { ...details, reason: 'inventory_changed' },
    });
  }
  return new OrderError('server', 'The order could not be confirmed.', { details });
}

/**
 * PostgREST context that is safe to log: codes and hints, never the query, never
 * a row, never a credential.
 */
function databaseDetails(error: DatabaseError): Record<string, unknown> {
  const details: Record<string, unknown> = {};
  if (typeof error.code === 'string') details.code = error.code;
  if (typeof error.hint === 'string') details.hint = error.hint;
  if (typeof error.details === 'string') details.details = error.details;
  return details;
}

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  const issue = result.error.issues[0];
  throw new OrderError('server', 'The database returned something unexpected.', {
    details: {
      reason: 'schema_mismatch',
      at: what,
      ...(issue === undefined ? {} : { field: issue.path.join('.') }),
    },
  });
}
