/**
 * ProductGrid.
 *
 * The one place the catalogue's card grid is laid out, so the home page's
 * curated strip and the catalogue page share a column count, a gap and a
 * loading state instead of drifting apart.
 *
 * ## Loading is skeletons, not an empty grid
 *
 * The database is written in parallel with this UI and an empty grid reads as
 * "Kanso sells nothing". So while the first read is in flight the grid draws
 * the shape of the answer — same columns, same card proportions — as
 * `aria-hidden` skeletons, with `aria-busy` and a label on the region so the
 * wait is announced once rather than ten times.
 *
 * `loading` is deliberately *not* "no products yet": changing the category
 * filter re-runs the query while the previous division's products are still in
 * `data`, and showing them under the new filter would be a lie. Skeletons cover
 * that window too.
 */

import { Skeleton } from '@/components/ui';
import type { Product } from '@/lib/supabase.types';
import { ProductCard } from './ProductCard';

/** Cards a skeleton grid draws while loading — enough to fill two rows. */
const DEFAULT_SKELETON_COUNT = 8;

/** Fixed keys: a skeleton has no identity, and its slot does not move. */
const SKELETON_KEYS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;

/**
 * A card-shaped skeleton, with the same row-then-column structure the real card
 * has, so the grid does not re-flow when the products arrive.
 */
function ProductCardSkeleton() {
  return (
    <div className="flex flex-col rounded-component border-hard border-hairline bg-surface-lowest">
      <div className="flex flex-1 gap-3 p-2.5 sm:flex-col sm:p-0">
        <Skeleton className="aspect-[4/3] w-[120px] shrink-0 sm:mb-3 sm:w-full" />
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:p-3 sm:pt-0">
          <Skeleton className="h-3 w-2/5" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-1/4" />
        </div>
      </div>
      <Skeleton className="min-h-16 border-t border-hairline" />
    </div>
  );
}

export interface ProductGridProps {
  products: readonly Product[];
  /** A read is in flight and there is nothing settled to show. */
  loading?: boolean;
  skeletonCount?: number;
  /** `sizes` for every card's photograph, matched to the grid's columns. */
  sizes?: string;
  /** How many leading cards are above the fold and should load eagerly. */
  priorityCount?: number;
}

export function ProductGrid({
  products,
  loading = false,
  skeletonCount = DEFAULT_SKELETON_COUNT,
  sizes,
  priorityCount = 0,
}: ProductGridProps) {
  if (loading) {
    return (
      // `role="status"` with `aria-busy` is the honest combination: the label is
      // announced once the busy flag clears, not on every skeleton render.
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading products"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        {SKELETON_KEYS.slice(0, skeletonCount).map((key) => (
          <ProductCardSkeleton key={key} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {products.map((product, index) => (
        <ProductCard
          key={product.id}
          product={product}
          sizes={sizes}
          priority={index < priorityCount}
        />
      ))}
    </div>
  );
}
