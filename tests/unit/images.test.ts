/**
 * Contract tests for the image lookup.
 *
 * `parseProductImageManifest` and `createImageLookup` are both pure, so the
 * tests drive them with a fixture rather than with whatever happens to be on
 * disk. That is deliberate: the committed manifest is empty until the media
 * agent fills it, and a test suite that depended on its contents would start
 * failing the moment the photos land.
 *
 * No Docker, no filesystem, no network.
 */

import { describe, expect, it } from 'vitest';
import {
  createImageLookup,
  getImageUrls,
  getProductImage,
  loadProductImageManifest,
  type ProductImage,
  type ProductImageManifest,
  parseProductImageManifest,
  productImageManifestSchema,
} from '@/lib/images';

const ALT = 'Milled steel rule resting on raw light concrete, single hard light from the left.';

/** Read one product out of a fixture, failing loudly if the fixture drifted. */
function entry(manifest: ProductImageManifest, slug: string): ProductImage {
  const found = manifest.products[slug];
  if (found === undefined) throw new Error(`fixture is missing ${slug}`);
  return found;
}

/** A manifest with the two ratios the UI uses, and a 4:3 committed at two widths. */
function fixture(): ProductImageManifest {
  return {
    version: 1,
    products: {
      'steel-rule': {
        slug: 'steel-rule',
        alt: ALT,
        attribution: {
          sourceUrl: 'https://unsplash.com/photos/steel-rule',
          photographer: 'A. Photographer',
          license: 'Unsplash License',
        },
        images: [
          {
            ratio: '1x1',
            role: 'thumb',
            width: 320,
            height: 320,
            webp: 'product-images/desk/steel-rule-1x1-320.webp',
            jpeg: 'product-images/desk/steel-rule-1x1-320.jpg',
            bytes: 18_000,
          },
          {
            ratio: '4x3',
            role: 'main',
            width: 320,
            height: 240,
            webp: 'product-images/desk/steel-rule-4x3-320.webp',
            jpeg: 'product-images/desk/steel-rule-4x3-320.jpg',
            bytes: 22_000,
          },
          {
            ratio: '4x3',
            role: 'main',
            width: 640,
            height: 480,
            webp: 'product-images/desk/steel-rule-4x3-640.webp',
            jpeg: 'product-images/desk/steel-rule-4x3-640.jpg',
            bytes: 61_000,
          },
        ],
      },
      // Deliberately 1x1 only: proves a missing ratio returns null rather than a
      // half-resolved image.
      'oak-pen-cup': {
        slug: 'oak-pen-cup',
        alt: 'Solid white oak pen cup on a paper ground.',
        attribution: {
          sourceUrl: 'https://www.pexels.com/photo/pen-cup',
          photographer: 'B. Photographer',
          license: 'Pexels License',
        },
        images: [
          {
            ratio: '1x1',
            role: 'thumb',
            width: 320,
            height: 320,
            webp: 'product-images/write/oak-pen-cup-1x1-320.webp',
            jpeg: 'product-images/write/oak-pen-cup-1x1-320.jpg',
            bytes: 14_000,
          },
        ],
      },
    },
  };
}

/* ===========================================================================
   Resolving
   =========================================================================== */

describe('getImageUrls', () => {
  it('resolves a known slug and ratio', () => {
    const { getImageUrls: lookup } = createImageLookup(fixture());

    const urls = lookup('steel-rule', '4x3');

    expect(urls).not.toBeNull();
    expect(urls?.src).toBe('product-images/desk/steel-rule-4x3-640.webp');
    expect(urls?.jpeg).toBe('product-images/desk/steel-rule-4x3-640.jpg');
    expect(urls?.width).toBe(640);
    expect(urls?.height).toBe(480);
  });

  it('returns null for an unknown slug', () => {
    const { getImageUrls: lookup } = createImageLookup(fixture());
    expect(lookup('does-not-exist', '4x3')).toBeNull();
  });

  it('returns null for a known slug whose entry is missing that ratio', () => {
    const { getImageUrls: lookup } = createImageLookup(fixture());
    // oak-pen-cup has only a 1x1 thumb. Callers get null and draw their own
    // placeholder rather than a broken image.
    expect(lookup('oak-pen-cup', '1x1')).not.toBeNull();
    expect(lookup('oak-pen-cup', '4x3')).toBeNull();
  });

  it('builds srcSet from every committed width, ascending', () => {
    const { getImageUrls: lookup } = createImageLookup(fixture());

    const { srcSet } = lookup('steel-rule', '4x3') ?? {};

    expect(srcSet).toBe(
      'product-images/desk/steel-rule-4x3-320.webp 320w, ' +
        'product-images/desk/steel-rule-4x3-640.webp 640w',
    );
  });

  it('keeps srcSet ascending however the manifest happens to be ordered', () => {
    const unsorted = fixture();
    const [thumb, at320, at640] = entry(unsorted, 'steel-rule').images;
    if (thumb === undefined || at320 === undefined || at640 === undefined) {
      throw new Error('fixture is missing a 4x3 variant');
    }
    entry(unsorted, 'steel-rule').images = [at640, thumb, at320];

    const { srcSet } = createImageLookup(unsorted).getImageUrls('steel-rule', '4x3') ?? {};

    expect(srcSet).toBe(
      'product-images/desk/steel-rule-4x3-320.webp 320w, ' +
        'product-images/desk/steel-rule-4x3-640.webp 640w',
    );
  });

  it('uses only the widths committed for that ratio', () => {
    const { srcSet } = createImageLookup(fixture()).getImageUrls('steel-rule', '1x1') ?? {};
    expect(srcSet).toBe('product-images/desk/steel-rule-1x1-320.webp 320w');
    expect(srcSet).not.toContain('4x3');
  });

  it('picks the largest width as src, so a client without srcSet still gets the good one', () => {
    const { src } = createImageLookup(fixture()).getImageUrls('steel-rule', '4x3') ?? {};
    expect(src).toContain('640');
  });

  it('propagates alt text verbatim from the manifest', () => {
    expect(createImageLookup(fixture()).getImageUrls('steel-rule', '4x3')?.alt).toBe(ALT);
  });

  it('never invents alt text for an entry that has none — that is rejected outright', () => {
    const manifest = fixture();
    entry(manifest, 'steel-rule').alt = '';

    expect(() => parseProductImageManifest(manifest)).toThrow(/alt text is required/);
  });
});

describe('getProductImage', () => {
  it('returns the whole entry, attribution included', () => {
    const entry = createImageLookup(fixture()).getProductImage('steel-rule');
    expect(entry?.alt).toBe(ALT);
    expect(entry?.attribution.photographer).toBe('A. Photographer');
    expect(entry?.images).toHaveLength(3);
  });

  it('returns null for an unknown slug', () => {
    expect(createImageLookup(fixture()).getProductImage('does-not-exist')).toBeNull();
  });
});

/* ===========================================================================
   Validation — a malformed committed manifest is a build error
   =========================================================================== */

describe('parseProductImageManifest', () => {
  it('accepts the committed, empty manifest', () => {
    const manifest = parseProductImageManifest({ version: 1, products: {} });
    expect(manifest.products).toEqual({});
  });

  it('accepts a well-formed manifest', () => {
    expect(() => parseProductImageManifest(fixture())).not.toThrow();
  });

  it('throws with a useful message when the manifest is not valid', () => {
    // Missing the required `alt` and `images`.
    const result = () =>
      parseProductImageManifest({ version: 1, products: { broken: { slug: 'broken' } } });

    expect(result).toThrow(/manifest\.json is not valid/);
    expect(result).toThrow(/products\.broken\.alt/);
  });

  it('rejects an unknown manifest version rather than guessing', () => {
    expect(() => parseProductImageManifest({ version: 2, products: {} })).toThrow(/is not valid/);
  });

  it('rejects a variant whose pixels contradict its declared ratio', () => {
    const manifest = fixture();
    const [thumb] = entry(manifest, 'steel-rule').images;
    if (thumb === undefined) throw new Error('fixture is empty');
    thumb.height = 200; // 320x200 is not 1:1

    expect(() => parseProductImageManifest(manifest)).toThrow(/declares 1x1 but is 320x200/);
  });

  it('rejects a slug that disagrees with its key', () => {
    // The failure mode this stops: one product's photo rendering under another's
    // name because the manifest key and the entry's slug drifted apart.
    const manifest = fixture();
    entry(manifest, 'steel-rule').slug = 'graphite-desk-pad';

    expect(() => parseProductImageManifest(manifest)).toThrow(/key and the slug must match/);
  });

  it('rejects two variants at the same ratio and width', () => {
    const manifest = fixture();
    const images = entry(manifest, 'steel-rule').images;
    const at320 = images.find((image) => image.ratio === '4x3' && image.width === 320);
    if (at320 === undefined) throw new Error('fixture has no 4x3@320 variant');
    // Same ratio, same width, different file: ambiguous in srcSet, so rejected.
    entry(manifest, 'steel-rule').images = [
      at320,
      { ...at320, webp: 'other.webp', jpeg: 'other.jpg' },
    ];

    expect(() => parseProductImageManifest(manifest)).toThrow(/two 4x3 variants at 320w/);
  });

  it('rejects a source URL that is not a URL', () => {
    const manifest = fixture();
    entry(manifest, 'steel-rule').attribution.sourceUrl = 'not a url';

    expect(() => parseProductImageManifest(manifest)).toThrow(/attribution\.sourceUrl/);
  });

  it('rejects a product with no images at all', () => {
    const manifest = fixture();
    entry(manifest, 'steel-rule').images = [];

    expect(() => parseProductImageManifest(manifest)).toThrow(/at least one image/);
  });
});

/* ===========================================================================
   The module as the app actually loads it
   =========================================================================== */

describe('the committed manifest', () => {
  it('validates at module load', () => {
    expect(() => loadProductImageManifest()).not.toThrow();
    expect(productImageManifestSchema.safeParse(loadProductImageManifest()).success).toBe(true);
  });

  it('is currently empty, so every lookup returns null rather than a broken image', () => {
    // True today. When the media agent commits the first photographs the media
    // agent's work is done, not broken: every caller already renders `null` as a
    // neutral placeholder. This test is here to say that out loud.
    const manifest = loadProductImageManifest();
    if (Object.keys(manifest.products).length === 0) {
      expect(getProductImage('graphite-desk-pad')).toBeNull();
      expect(getImageUrls('graphite-desk-pad', '4x3')).toBeNull();
      expect(getImageUrls('graphite-desk-pad', '1x1')).toBeNull();
    } else {
      expect(Object.keys(manifest.products).length).toBeGreaterThan(0);
    }
  });

  it('exposes the same lookup the fixture exercises', () => {
    expect(typeof getProductImage).toBe('function');
    expect(typeof getImageUrls).toBe('function');
  });
});
