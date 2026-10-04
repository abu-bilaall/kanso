/**
 * Contract tests for the catalogue hooks, against a recording Supabase double.
 *
 * What is pinned here is what six parallel agents depend on: the exact query
 * each hook issues, and how it maps a success, an empty result and a failure into
 * its documented return shape. No Docker, no database.
 */

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useProduct } from '@/hooks/useProduct';
import { useProducts } from '@/hooks/useProducts';
import type { Product } from '@/lib/supabase.types';
import { createFakeSupabase, type FakeSupabase } from './helpers/fakeSupabase';
import { supabaseHolder } from './helpers/supabaseHolder';

// Must be declared here, not in a helper: Vitest hoists `vi.mock` above this
// file's imports, so the hooks bind the mock rather than the real client.
vi.mock('@/lib/supabase', async () => {
  const actual = await vi.importActual<typeof import('@/lib/supabase')>('@/lib/supabase');
  return {
    ...actual,
    getSupabaseClient: () => {
      if (supabaseHolder.current === null) {
        throw new Error('No fake Supabase client installed for this test.');
      }
      return supabaseHolder.current;
    },
  };
});

const PRODUCT: Product = {
  id: 'p-1',
  slug: 'graphite-desk-pad',
  name: 'Graphite Desk Pad',
  category: 'desk',
  spec_line: 'Dense wool felt / 900x400mm',
  description: 'A dense felt mat.',
  price_kobo: 1850000,
  inventory: 24,
  image_path: 'product-images/graphite-desk-pad.webp',
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
};

/**
 * No session: the catalogue is publicly readable, so these hooks must never need
 * one. `renderHook` without the provider is therefore correct, not an oversight.
 */
function install(answer: Parameters<typeof createFakeSupabase>[1]): FakeSupabase {
  const client = createFakeSupabase({ session: null }, answer);
  supabaseHolder.current = client;
  return client;
}

beforeEach(() => {
  supabaseHolder.current = null;
});

describe('useProducts', () => {
  it('loads the whole catalogue and reports success', async () => {
    install({ products: [PRODUCT] });

    const { result } = renderHook(() => useProducts());

    expect(result.current.status).toBe('loading');
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.products).toEqual([PRODUCT]);
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('issues one unfiltered select', async () => {
    const client = install({ products: [] });

    const { result } = renderHook(() => useProducts());
    await waitFor(() => expect(result.current.status).toBe('success'));

    expect(client.calls).toHaveLength(1);
    const call = client.lastCall();
    expect(call?.table).toBe('products');
    expect(call?.op).toBe('select');
    expect(call?.filters).toEqual([]);
    expect(call?.cardinality).toBe('many');
  });

  it('filters in the database when a category is given', async () => {
    const client = install({ products: [PRODUCT] });

    const { result } = renderHook(() => useProducts({ category: 'carry' }));
    await waitFor(() => expect(result.current.status).toBe('success'));

    expect(client.lastCall()?.filters).toEqual([['category', 'carry']]);
  });

  it('returns an empty list, not an error, for an empty catalogue', async () => {
    install({ products: [] });

    const { result } = renderHook(() => useProducts());
    await waitFor(() => expect(result.current.status).toBe('success'));

    // Empty is a first-class state with its own UI, not an error.
    expect(result.current.products).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('degrades into an error state when the table does not exist yet', async () => {
    // The real shape during Phase 1: migrations have not landed.
    install({
      products: () => ({
        data: null,
        error: { message: 'relation "public.products" does not exist', code: '42P01' },
      }),
    });

    const { result } = renderHook(() => useProducts());
    await waitFor(() => expect(result.current.status).toBe('error'));

    expect(result.current.error?.code).toBe('server');
    expect(result.current.products).toEqual([]);
  });

  it('issues no query when disabled', async () => {
    const client = install({ products: [] });

    const { result } = renderHook(() => useProducts({ enabled: false }));
    await waitFor(() => expect(result.current.status).toBe('idle'));

    expect(client.calls).toHaveLength(0);
    expect(result.current.products).toEqual([]);
  });
});

describe('useProduct', () => {
  it('loads a product by slug', async () => {
    install({ 'products.select': PRODUCT });

    const { result } = renderHook(() => useProduct('graphite-desk-pad'));
    await waitFor(() => expect(result.current.status).toBe('success'));

    expect(result.current.product).toEqual(PRODUCT);
    expect(result.current.error).toBeNull();
  });

  it('queries by slug, once, optionally', async () => {
    const client = install({ 'products.select': PRODUCT });

    const { result } = renderHook(() => useProduct('graphite-desk-pad'));
    await waitFor(() => expect(result.current.status).toBe('success'));

    expect(client.calls).toHaveLength(1);
    expect(client.lastCall()?.filters).toEqual([['slug', 'graphite-desk-pad']]);
    expect(client.lastCall()?.cardinality).toBe('maybe');
  });

  it('reports a missing slug as not_found rather than a null product', async () => {
    install({ 'products.select': null });

    const { result } = renderHook(() => useProduct('does-not-exist'));
    await waitFor(() => expect(result.current.status).toBe('error'));

    expect(result.current.error?.code).toBe('not_found');
    // A 404 is not retryable, so the UI will not offer a useless "Try again".
    expect(result.current.error?.retryable).toBe(false);
    expect(result.current.product).toBeNull();
  });

  it('issues no query without a slug', async () => {
    const client = install({ 'products.select': PRODUCT });

    const { result } = renderHook(() => useProduct(undefined));
    await waitFor(() => expect(result.current.status).toBe('idle'));

    expect(client.calls).toHaveLength(0);
  });
});
