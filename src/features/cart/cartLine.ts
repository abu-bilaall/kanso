/**
 * Cart line arithmetic and the inventory guard.
 *
 * Everything here is pure on purpose: these are the rules that decide whether a
 * customer can select a quantity that does not exist, and a rule that cannot be
 * exercised without a browser and a database is a rule nobody checks.
 *
 * ## Why the guard is not just `max={inventory}`
 *
 * `QuantityControl` is clamped, not corrected — it will not emit a value outside
 * `[min, max]`. Passing `max={product.inventory}` stops a customer *raising* a
 * line past what exists, which is the whole requirement.
 *
 * It is not enough on its own, though. Stock moves between the moment a line is
 * added and the moment it is rendered: two people want the last desk weight, and
 * the row now says quantity 3 of an inventory of 2. Clamping `max` to 2 there
 * would leave the control showing 3 with both ends of the journey blocked, so
 * the upper bound rises to the quantity already on the line and `+` goes
 * `aria-disabled`. The customer can always walk it back down; they can never walk
 * it up. The shortfall is stated in words, naming the product and the count,
 * because a silently unreachable checkout is the failure mode this whole file
 * exists to prevent.
 */

import type { CartItemWithProduct } from '@/lib/supabase.types';

/** A line's stock position: what is on it, and what exists. */
export interface LineStockPosition {
  /** Units the product has right now. `0` is out of stock. */
  available: number;
  /** Units already on the cart line. Always `>= 1` for a persisted line. */
  quantity: number;
}

export interface LineQuantityBounds extends LineStockPosition {
  /**
   * The `max` handed to `QuantityControl`.
   *
   * `inventory` while the line is within stock, and the line's own quantity once
   * it is not — so `+` is always disabled and `-` always works.
   */
  max: number;
  /** The line holds more units than exist. */
  overAvailable: boolean;
  /** Nothing of this product can be ordered. */
  soldOut: boolean;
  /**
   * A sentence naming the product and the available count, or `null` when the
   * line is fine. Never genericised: "Something is unavailable" tells the
   * customer nothing they can act on.
   */
  message: string | null;
}

/**
 * The bounds a cart line's quantity control may offer.
 *
 * @param name Product name, used verbatim in the shortfall message.
 */
export function lineQuantityBounds(
  { available, quantity }: LineStockPosition,
  name: string,
): LineQuantityBounds {
  if (available <= 0) {
    return {
      available,
      quantity,
      max: 0,
      overAvailable: true,
      soldOut: true,
      message: `${name} is out of stock. Remove it to continue.`,
    };
  }

  if (quantity > available) {
    return {
      available,
      quantity,
      max: quantity,
      overAvailable: true,
      soldOut: false,
      message: `Only ${available} of ${name} left. Reduce the quantity to continue.`,
    };
  }

  return {
    available,
    quantity,
    max: available,
    overAvailable: false,
    soldOut: false,
    message: null,
  };
}

/**
 * The first stock problem on the cart, or `null` when every line can be ordered.
 *
 * Checkout is blocked while this returns a string: a line that cannot be
 * fulfilled fails the whole order server-side, and finding that out after
 * filling in seven fields is the worst possible moment to learn it.
 */
export function blockingStockMessage(items: readonly CartItemWithProduct[]): string | null {
  for (const item of items) {
    const available = item.product?.inventory ?? 0;
    const name = item.product?.name ?? 'A product in your cart';
    const bounds = lineQuantityBounds({ available, quantity: item.quantity }, name);
    if (bounds.message !== null) return bounds.message;
  }
  return null;
}
