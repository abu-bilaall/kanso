/**
 * The logic the storefront owns, pinned.
 *
 * Three things are tested here and nothing else: how a `?category=` and a
 * `?sort=` in the URL become a catalogue query and back again, how that query
 * reorders products, and how a quantity is clamped to real inventory. They are
 * the three pieces where being wrong is a business bug rather than a visual
 * one — an unreachable filter, a shuffled grid, or twelve of four sold.
 *
 * No rendering and no database: these are pure functions over plain objects.
 */

import { describe, expect, it } from 'vitest';
import { clampQuantity, isPurchasable, stockLabel, stockLevel } from '@/features/catalog/inventory';
import {
  ALL_CATEGORIES,
  catalogueHref,
  catalogueSearch,
  parseCategory,
  readCatalogueQuery,
} from '@/features/catalog/query';
import { parseSort, selectFeatured, sortProducts } from '@/features/catalog/sorting';
import type { Product } from '@/lib/supabase.types';

function product(overrides: Partial<Product> & Pick<Product, 'id' | 'slug' | 'name'>): Product {
  return {
    category: 'desk',
    spec_line: null,
    description: null,
    price_kobo: 100_000,
    inventory: 20,
    image_path: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const GRAPHITE_PAD = product({
  id: 'p-1',
  slug: 'graphite-desk-pad',
  name: 'Graphite Desk Pad',
  price_kobo: 1_850_000,
  inventory: 24,
});
const DESK_WEIGHT = product({
  id: 'p-2',
  slug: 'milled-desk-weight',
  name: 'Milled Desk Weight',
  price_kobo: 1_200_000,
  inventory: 18,
});
const FOUNTAIN_PEN = product({
  id: 'p-3',
  slug: 'technical-fountain-pen',
  name: 'Technical Fountain Pen',
  category: 'write',
  price_kobo: 2_400_000,
  inventory: 4,
});
const SOLD_OUT = product({
  id: 'p-4',
  slug: 'oak-pen-cup',
  name: 'Oak Pen Cup',
  price_kobo: 950_000,
  inventory: 0,
});

describe('category filter <-> URL param', () => {
  it('defaults to the whole catalogue when there is no param', () => {
    expect(parseCategory(undefined)).toBe(ALL_CATEGORIES);
    expect(parseCategory(null)).toBe(ALL_CATEGORIES);
    expect(parseCategory('')).toBe(ALL_CATEGORIES);
    expect(parseCategory('all')).toBe(ALL_CATEGORIES);
  });

  it('accepts every real division, case- and whitespace-insensitively', () => {
    expect(parseCategory('desk')).toBe('desk');
    expect(parseCategory(' Carry ')).toBe('carry');
    expect(parseCategory('WRITE')).toBe('write');
  });

  it('falls back to all for a value the catalogue does not have', () => {
    // A hand-edited URL, a stale bookmark, a division a future migration drops.
    // Anything else would render an empty catalogue with no explanation.
    expect(parseCategory('kitchen')).toBe(ALL_CATEGORIES);
    expect(parseCategory('desk;drop table products')).toBe(ALL_CATEGORIES);
  });

  it('writes the param only when it differs from the default', () => {
    expect(catalogueHref({ category: ALL_CATEGORIES, sort: 'featured' })).toBe('/shop');
    expect(catalogueHref({ category: 'desk', sort: 'featured' })).toBe('/shop?category=desk');
    expect(catalogueHref({ category: ALL_CATEGORIES, sort: 'price-asc' })).toBe(
      '/shop?sort=price-asc',
    );
    expect(catalogueHref({ category: 'write', sort: 'price-desc' })).toBe(
      '/shop?category=write&sort=price-desc',
    );
  });

  it('round-trips a link through the URL and back', () => {
    const query = { category: 'carry' as const, sort: 'name' as const };
    const href = catalogueHref(query);
    const parsed = readCatalogueQuery(new URLSearchParams(href.split('?')[1]));
    expect(parsed).toEqual(query);
    expect(catalogueSearch(query)).toBe('category=carry&sort=name');
  });
});

describe('sort', () => {
  it('treats an unknown or missing value as featured', () => {
    expect(parseSort(null)).toBe('featured');
    expect(parseSort('')).toBe('featured');
    expect(parseSort('material')).toBe('featured');
    expect(parseSort(' price-asc ')).toBe('price-asc');
  });

  it('leaves the database order alone for featured, without mutating the input', () => {
    const products = [DESK_WEIGHT, GRAPHITE_PAD, FOUNTAIN_PEN];
    expect(sortProducts(products, 'featured')).toEqual(products);
    expect(sortProducts(products, 'featured')).not.toBe(products);
  });

  it('orders by price in kobo, both directions', () => {
    const products = [GRAPHITE_PAD, FOUNTAIN_PEN, DESK_WEIGHT];
    expect(sortProducts(products, 'price-asc').map((p) => p.slug)).toEqual([
      'milled-desk-weight',
      'graphite-desk-pad',
      'technical-fountain-pen',
    ]);
    expect(sortProducts(products, 'price-desc').map((p) => p.slug)).toEqual([
      'technical-fountain-pen',
      'graphite-desk-pad',
      'milled-desk-weight',
    ]);
  });

  it('breaks a price tie by name, so equal prices never swap between renders', () => {
    const twinA = product({ id: 'p-9', slug: 'a', name: 'A Rule', price_kobo: 750_000 });
    const twinB = product({ id: 'p-8', slug: 'b', name: 'B Rule', price_kobo: 750_000 });
    expect(sortProducts([twinB, twinA], 'price-asc').map((p) => p.name)).toEqual([
      'A Rule',
      'B Rule',
    ]);
  });

  it('orders by name', () => {
    const products = [FOUNTAIN_PEN, DESK_WEIGHT, GRAPHITE_PAD];
    expect(sortProducts(products, 'name').map((p) => p.name)).toEqual([
      'Graphite Desk Pad',
      'Milled Desk Weight',
      'Technical Fountain Pen',
    ]);
  });

  it('features the first thing in the catalogue a visitor could buy', () => {
    expect(selectFeatured([SOLD_OUT, DESK_WEIGHT, GRAPHITE_PAD])).toBe(DESK_WEIGHT);
    // Nothing purchasable: the first product is still the honest answer.
    expect(selectFeatured([SOLD_OUT, { ...SOLD_OUT, id: 'p-5', slug: 'steel-rule' }])).toBe(
      SOLD_OUT,
    );
    expect(selectFeatured([])).toBeNull();
  });
});

describe('stock', () => {
  it('names the three states in words', () => {
    expect(stockLevel(24)).toBe('in-stock');
    expect(stockLevel(4)).toBe('low');
    expect(stockLevel(0)).toBe('out-of-stock');
    expect(stockLevel(Number.NaN)).toBe('out-of-stock');
  });

  it('counts what is left when stock is low, and says so when there is none', () => {
    expect(stockLabel(24)).toBe('In stock');
    expect(stockLabel(4)).toBe('Low stock — 4 left');
    expect(stockLabel(0)).toBe('Sold out');
  });

  it('refuses to call an unknown inventory purchasable', () => {
    expect(isPurchasable(1)).toBe(true);
    expect(isPurchasable(0)).toBe(false);
    expect(isPurchasable(Number.NaN)).toBe(false);
  });
});

describe('quantity clamp', () => {
  it('holds the selection at or below available inventory', () => {
    expect(clampQuantity(1, 4)).toBe(1);
    expect(clampQuantity(3, 4)).toBe(3);
    expect(clampQuantity(4, 4)).toBe(4);
    expect(clampQuantity(5, 4)).toBe(4);
    expect(clampQuantity(99, 24)).toBe(24);
  });

  it('never drops below one while anything is for sale', () => {
    expect(clampQuantity(0, 24)).toBe(1);
    expect(clampQuantity(-5, 24)).toBe(1);
    expect(clampQuantity(Number.NaN, 24)).toBe(1);
  });

  it('selects nothing at all when there is nothing to select', () => {
    expect(clampQuantity(1, 0)).toBe(0);
    expect(clampQuantity(3, 0)).toBe(0);
    expect(clampQuantity(1, Number.NaN)).toBe(0);
  });

  it('treats fractional stock as whole units', () => {
    expect(clampQuantity(9, 3.7)).toBe(3);
  });
});
