/**
 * `useProduct` — one product, by slug.
 *
 * The product detail route is `/product/:slug`, so the slug is the identifier.
 * Slugs are unique in the database; a miss is a `not_found` error rather than
 * `null`, so the page has exactly one thing to render an empty state for.
 *
 * ## Errors
 *
 * - `status: 'error'`, `error.code: 'not_found'` when no product has that slug.
 *   Render a 404 panel — do not offer "try again", a retry cannot change it.
 * - Missing table, RLS refusal or offline all arrive as `status: 'error'` with a
 *   normalised {@link AppError}. Never throws.
 * - Passing `undefined` (the router has no `:slug` yet) leaves the resource
 *   `idle` and issues no query.
 */

import { useMemo } from 'react';
import { AppError, toAppError } from '@/lib/errors';
import { getSupabaseClient } from '@/lib/supabase';
import type { Product } from '@/lib/supabase.types';
import { type AsyncStatus, useAsyncResource } from './internal/useAsyncResource';

export interface UseProductOptions {
  /** Skip the query. Defaults to `true` only when a slug is present. */
  enabled?: boolean;
}

export interface ProductState {
  product: Product | null;
  status: AsyncStatus;
  error: AppError | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

export function useProduct(
  slug: string | undefined,
  options: UseProductOptions = {},
): ProductState {
  const { enabled = slug !== undefined && slug.length > 0 } = options;

  const resource = useAsyncResource<Product>(
    async () => {
      if (slug === undefined) {
        throw new AppError('not_found', 'No product was requested.');
      }

      const { data, error } = await getSupabaseClient()
        .from('products')
        .select('*')
        .eq('slug', slug)
        .maybeSingle();

      if (error) throw toAppError(error, 'Could not load this product');
      if (data === null) {
        throw new AppError('not_found', 'We could not find that product.', {
          details: { slug },
        });
      }
      return data;
    },
    { enabled, logEvent: 'product_loaded', logFields: { slug } },
  );

  return useMemo(
    () => ({
      product: resource.data,
      status: resource.status,
      error: resource.error,
      isLoading: resource.isLoading,
      refresh: resource.refresh,
    }),
    [resource],
  );
}
