/**
 * Catalogue ordering.
 *
 * `useProducts` returns the database's order — `created_at` then `name` — and
 * that order *is* the curation: "Featured" is whatever the catalogue says comes
 * first. Everything else is computed here, over the array the hook returns,
 * which is the division of labour `docs/CONTRACTS.md` draws: the hook filters
 * in the database, the page sorts in JavaScript.
 *
 * The Stitch catalogue prototype has an ORDER control, so there is a sort. Its
 * fourth option is "Material Composition", which the `products` table has no
 * column for; that one is in `docs/CONTRACT-REQUESTS.md` and the slot is a name
 * sort instead.
 */

import type { Product } from '@/lib/supabase.types';
import { isPurchasable } from './inventory';

export type CatalogueSort = 'featured' | 'price-asc' | 'price-desc' | 'name';

/** Query param the sort is read from and written to. */
export const SORT_PARAM = 'sort';

export const SORT_OPTIONS: ReadonlyArray<{ value: CatalogueSort; label: string }> = [
  { value: 'featured', label: 'Featured' },
  { value: 'price-asc', label: 'Price: low to high' },
  { value: 'price-desc', label: 'Price: high to low' },
  { value: 'name', label: 'Name: A–Z' },
];

/** Any string the URL can hold resolves to a sort. Unknown values mean Featured. */
export function parseSort(raw: string | null | undefined): CatalogueSort {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return SORT_OPTIONS.some((option) => option.value === value)
    ? (value as CatalogueSort)
    : 'featured';
}

/**
 * Tie-break for the price sorts, which can compare equal. Two products at the
 * same price must not swap places between renders, so the order falls through
 * to the name and then the id — a total order, and a stable one.
 */
function byName(a: Product, b: Product): number {
  const byTitle = a.name.localeCompare(b.name, 'en');
  return byTitle === 0 ? a.id.localeCompare(b.id) : byTitle;
}

/**
 * A sorted copy of `products`. Never mutates, and never reorders 'featured' —
 * the database's order is the featured order.
 */
export function sortProducts(products: readonly Product[], sort: CatalogueSort): Product[] {
  const sorted = [...products];
  switch (sort) {
    case 'price-asc':
      return sorted.sort((a, b) => a.price_kobo - b.price_kobo || byName(a, b));
    case 'price-desc':
      return sorted.sort((a, b) => b.price_kobo - a.price_kobo || byName(a, b));
    case 'name':
      return sorted.sort(byName);
    default:
      return sorted;
  }
}

/**
 * The storefront's flagship: the first product in catalogue order a visitor
 * could actually buy. An out-of-stock object cannot be the thing the home page
 * asks a visitor to look at, so it is skipped; if nothing is purchasable, the
 * first product is still the best answer available.
 */
export function selectFeatured(products: readonly Product[]): Product | null {
  return products.find((product) => isPurchasable(product.inventory)) ?? products[0] ?? null;
}
