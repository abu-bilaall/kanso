/**
 * Everything the storefront derives from `products.inventory`.
 *
 * Inventory is authoritative in the database and is decremented server-side by
 * `create-order`, so the browser only ever *reads* it. Three questions come off
 * that one column — how loudly to announce the stock, whether a visitor can
 * buy at all, and how many units they are allowed to select — and answering
 * them in one place keeps the grid, the product page and the cart from
 * disagreeing about the same product.
 *
 * `create-order` enforces the quantity limit again, server-side. This clamp is
 * the courtesy that stops a shopper selecting twelve of four.
 */

/**
 * Units at or below which a product is announced as low stock.
 *
 * PLAN §2.4 seeds `technical-fountain-pen` at 4 and `canvas-messenger-bag` at 6,
 * so this threshold separates the two deliberately: five is the point where
 * "in stock" stops being reassuring.
 */
export const LOW_STOCK_THRESHOLD = 5;

export type StockLevel = 'in-stock' | 'low' | 'out-of-stock';

/**
 * The three stock states, from an inventory count.
 *
 * A non-finite count is treated as sold out rather than in stock: a card that
 * claims availability it cannot substantiate is worse than one that admits
 * nothing is known.
 */
export function stockLevel(inventory: number): StockLevel {
  if (!Number.isFinite(inventory) || inventory <= 0) return 'out-of-stock';
  return inventory <= LOW_STOCK_THRESHOLD ? 'low' : 'in-stock';
}

/** The stock state in words. Never empty — colour never carries this alone. */
export function stockLabel(inventory: number): string {
  switch (stockLevel(inventory)) {
    case 'out-of-stock':
      return 'Sold out';
    case 'low':
      return `Low stock — ${Math.trunc(inventory)} left`;
    default:
      return 'In stock';
  }
}

/** Whether a visitor may add this product to a cart at all. */
export function isPurchasable(inventory: number): boolean {
  return Number.isFinite(inventory) && inventory > 0;
}

/**
 * The quantity a visitor is allowed to hold for a product with `inventory` units.
 *
 * Returns `0` when there is nothing to buy, which is the honest answer for a
 * sold-out product: a caller that renders a quantity control shows a control
 * that cannot move rather than offering `1` of nothing.
 */
export function clampQuantity(quantity: number, inventory: number): number {
  if (!isPurchasable(inventory)) return 0;
  const wanted = Number.isFinite(quantity) ? Math.trunc(quantity) : 1;
  return Math.min(Math.trunc(inventory), Math.max(1, wanted));
}
