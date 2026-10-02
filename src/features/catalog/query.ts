/**
 * The catalogue's query string, read and written.
 *
 * `/shop?category=desk&sort=price-asc`. The filter lives in the URL and not in
 * component state, which buys three things for free: a filtered view is
 * shareable, the browser's back button steps back through the filters, and the
 * router — not a `useEffect` — decides what to re-render.
 *
 * Reading is **total**: every string the URL can legally hold resolves to a
 * valid query. `?category=`, an unknown division from a future migration, a
 * typo, a hand-edited value — all of them land on "all" rather than rendering
 * an empty catalogue with no explanation.
 */

import type { ProductCategoryFilter } from '@/hooks';
import { PRODUCT_CATEGORIES, type ProductCategory } from '@/lib/supabase.types';
import { CATEGORY_PARAM, ROUTE_PATHS } from '@/routes';
import { type CatalogueSort, parseSort, SORT_PARAM } from './sorting';

/** The unfiltered catalogue. The default, and the fallback for anything invalid. */
export const ALL_CATEGORIES: ProductCategoryFilter = 'all';

function isProductCategory(value: string): value is ProductCategory {
  return (PRODUCT_CATEGORIES as readonly string[]).includes(value);
}

/**
 * A `?category=` value as a filter.
 *
 * `src/lib/supabase.types.ts` is the source of truth for the divisions rather
 * than a hand-written list here, so a fourth division added by a migration
 * becomes a valid filter without this file being edited.
 */
export function parseCategory(raw: string | null | undefined): ProductCategoryFilter {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (value === '' || value === ALL_CATEGORIES) return ALL_CATEGORIES;
  return isProductCategory(value) ? value : ALL_CATEGORIES;
}

export interface CatalogueQuery {
  category: ProductCategoryFilter;
  sort: CatalogueSort;
}

export function readCatalogueQuery(params: URLSearchParams): CatalogueQuery {
  return {
    category: parseCategory(params.get(CATEGORY_PARAM)),
    sort: parseSort(params.get(SORT_PARAM)),
  };
}

/**
 * The query string for a query, with both defaults omitted so that "no
 * filter, featured order" is `/shop` rather than `/shop?category=all`.
 */
export function catalogueSearch({ category, sort }: CatalogueQuery): string {
  const params = new URLSearchParams();
  if (category !== ALL_CATEGORIES) params.set(CATEGORY_PARAM, category);
  if (sort !== 'featured') params.set(SORT_PARAM, sort);
  return params.toString();
}

/** The `/shop` URL for a query. The filter links are these, not click handlers. */
export function catalogueHref(query: CatalogueQuery): string {
  const search = catalogueSearch(query);
  return search.length === 0 ? ROUTE_PATHS.catalog : `${ROUTE_PATHS.catalog}?${search}`;
}
