/**
 * `useProducts` — the catalogue.
 *
 * One query, publicly readable, no parameters required. Everything a catalogue
 * grid needs (name, price, stock, slug, category) arrives on the row; there is
 * no N+1 follow-up and no separate availability endpoint.
 *
 * ## Ordering
 *
 * The server orders by `created_at` ascending, then `name`. There is no
 * "featured" flag in V1 — sorting is the catalogue page's business (A4) and it
 * happens over the array this hook returns.
 *
 * ## Errors
 *
 * Never throws. A missing table, an RLS refusal, an offline browser all arrive
 * as `status: 'error'` with a normalised {@link AppError}.
 */

import { useMemo } from 'react';
import type { AppError } from '@/lib/errors';
import { toAppError } from '@/lib/errors';
import { getSupabaseClient } from '@/lib/supabase';
import type { Product, ProductCategory } from '@/lib/supabase.types';
import { type AsyncStatus, useAsyncResource } from './internal/useAsyncResource';

export type ProductCategoryFilter = ProductCategory | 'all';

export interface UseProductsOptions {
  /** `'all'` (default) returns everything. A category filters in the database. */
  category?: ProductCategoryFilter;
  /** Skip the query entirely. Used by pages that have nothing to show yet. */
  enabled?: boolean;
}

export interface ProductsState {
  /** Empty array while loading, on error, and for a genuinely empty catalogue. */
  products: Product[];
  status: AsyncStatus;
  error: AppError | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

export function useProducts(options: UseProductsOptions = {}): ProductsState {
  const { category = 'all', enabled = true } = options;

  const resource = useAsyncResource<Product[]>(
    async () => {
      const client = getSupabaseClient();
      let query = client
        .from('products')
        .select('*')
        .order('created_at', { ascending: true })
        .order('name', { ascending: true });

      if (category !== 'all') {
        query = query.eq('category', category);
      }

      const { data, error } = await query;
      if (error) throw toAppError(error, 'Could not load the catalogue');
      return data ?? [];
    },
    {
      enabled,
      logEvent: 'catalogue_loaded',
      logFields: { category },
    },
  );

  return useMemo(
    () => ({
      products: resource.data ?? [],
      status: resource.status,
      error: resource.error,
      isLoading: resource.isLoading,
      refresh: resource.refresh,
    }),
    [resource],
  );
}

/** The three divisions, in storefront order. A page filter renders from this. */
export const CATEGORIES: ReadonlyArray<{ value: ProductCategory; label: string }> = [
  { value: 'desk', label: 'Desk' },
  { value: 'carry', label: 'Carry' },
  { value: 'write', label: 'Write' },
];

/**
 * Label for a category slug. Accepts anything (including a slug from the future
 * database) and falls back to a title-cased slug rather than throwing — a
 * product with an unknown division must still render.
 */
export function categoryLabel(category: string): string {
  const known = CATEGORIES.find((entry) => entry.value === category);
  if (known !== undefined) return known.label;
  return `${category.charAt(0).toUpperCase()}${category.slice(1)}`;
}
