/**
 * StockBadge.
 *
 * One chip, three states, one source of truth: `stockLevel` in
 * `@/features/catalog/inventory`. The catalogue grid and the product page both
 * read it, so a product cannot be "in stock" on one page and "sold out" on the
 * other.
 *
 * The tones are deliberately uneven. "In stock" is the absence of a problem, so
 * it takes a quiet neutral chip; chartreuse — the one accent per view — is spent
 * on the state that deserves attention, low stock; only a sold-out product gets
 * the danger surface. The text carries the meaning either way, which is what
 * DESIGN.md asks for and what `Badge` enforces by requiring children.
 */

import { Badge, type BadgeTone } from '@/components/ui';
import { type StockLevel, stockLabel, stockLevel } from '@/features/catalog/inventory';

const TONE_BY_LEVEL: Readonly<Record<StockLevel, BadgeTone>> = {
  'in-stock': 'neutral',
  low: 'accent',
  'out-of-stock': 'danger',
};

export interface StockBadgeProps {
  /** `products.inventory`. Never a boolean — the count is what says "4 left". */
  inventory: number;
  /**
   * Announce a change to assistive tech. Off by default: a grid of ten cards
   * would carry ten live regions, and a live region that is announced on load
   * is noise. The product page, where stock is the answer to the visitor's
   * question, opts in.
   */
  live?: boolean;
  className?: string;
}

export function StockBadge({ inventory, live = false, className = '' }: StockBadgeProps) {
  return (
    <Badge tone={TONE_BY_LEVEL[stockLevel(inventory)]} live={live} className={className}>
      {stockLabel(inventory)}
    </Badge>
  );
}
