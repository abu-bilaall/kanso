/**
 * The authoritative order total.
 *
 * Prices and inventory come from `products` via the store, never from the
 * request body — `createOrderPayloadSchema` strips unknown keys, so a client
 * has nowhere to put a price even if it wanted to. Every number below is
 * integer kobo and every total is a sum of integer products, so there is
 * nothing to drift.
 *
 * Pure: the same function prices a mocked cart in a unit test and a real one in
 * production.
 */

import { OrderError } from './order-error.ts';
import type { CartEvaluation, CartLine, InventoryShortfall } from './types.ts';

/**
 * Price a cart and say which lines the catalogue cannot supply.
 *
 * Returns every shortfall rather than the first, so one event can describe the
 * whole problem; the caller decides which one the customer is told about.
 */
export function evaluateCart(lines: CartLine[]): CartEvaluation {
  let totalKobo = 0;
  let itemCount = 0;
  const shortfalls: InventoryShortfall[] = [];

  const priced = lines.map((line) => {
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      // A cart row with a non-positive quantity is corrupt data, not a customer
      // mistake, and there is no honest quantity to show them.
      throw new OrderError('server', 'Your cart could not be read. Try again.', {
        details: { reason: 'invalid_cart_quantity', productId: line.productId },
      });
    }
    if (!Number.isInteger(line.unitPriceKobo) || line.unitPriceKobo < 0) {
      throw new OrderError('server', 'A catalogue price is invalid. Try again.', {
        details: { reason: 'invalid_price', productId: line.productId },
      });
    }

    if (line.inventory < line.quantity) {
      shortfalls.push({
        productId: line.productId,
        slug: line.slug,
        productName: line.productName,
        requested: line.quantity,
        available: line.inventory,
      });
    }

    const lineTotalKobo = line.unitPriceKobo * line.quantity;
    totalKobo += lineTotalKobo;
    itemCount += line.quantity;
    return { ...line, lineTotalKobo };
  });

  return { lines: priced, itemCount, totalKobo, shortfalls };
}
