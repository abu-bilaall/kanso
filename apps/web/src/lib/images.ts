/**
 * Product imagery — the typed lookup over `product-images/manifest.json`.
 *
 * FROZEN CONTRACT SURFACE. Three agents render product photos (storefront, cart
 * and checkout, account). The media agent owns the *pipeline* and the manifest
 * *contents*; this module owns the *shape*, so none of those agents is blocked
 * waiting for a file that does not exist yet.
 *
 * ## Why the manifest rather than Storage
 *
 * The media agent commits its derived derivatives (PLAN §4), so the browser can
 * read the manifest at build time and get real URLs immediately — with no
 * Storage round trip, no loading spinner before the first image can even start,
 * and no dependency on the data layer. `products.image_path` still records the
 * Storage object for the record; the storefront renders from the manifest.
 *
 * ## Design notes
 *
 * - **No React in this module.** It is a pure lookup and must stay usable from a
 *   route loader, a script, or a test.
 * - **Validation is pure, the module load is thin.** {@link parseProductImageManifest}
 *   takes any input and returns a validated manifest or throws;
 *   {@link createImageLookup} is a pure function of a validated manifest. That
 *   split is what makes the lookup testable without touching the filesystem, and
 *   it is why this file has one exported function per concept rather than
 *   module-level state doing the work.
 * - **A malformed manifest is a build error, not a runtime state.** Unlike the
 *   data hooks — which degrade into an error state because the database may
 *   legitimately be missing — the manifest is a committed source file. A
 *   malformed one is a merge mistake, and it throws at module load with a
 *   message that names the offending product and field.
 */

import { z } from 'zod';
import manifestJson from '../../../../product-images/manifest.json';
import { ConfigurationError } from './errors';

/** The two crops the UI uses. PLAN §4: 4:3 main at 640w, 1:1 thumb at 320w. */
export const IMAGE_RATIOS = ['4x3', '1x1'] as const;
export type ImageRatio = (typeof IMAGE_RATIOS)[number];

/** What a crop is *for*. Informational — the lookup keys on `ratio`, not `role`. */
export const IMAGE_ROLES = ['main', 'thumb'] as const;
export type ImageRole = (typeof IMAGE_ROLES)[number];

/**
 * Numeric pixel ratio for each named crop, for `aspect-ratio` in CSS.
 * Derived rather than written down, so a variant's `width`/`height` can be
 * checked against its declared ratio and they can never drift apart.
 */
const RATIO_VALUE: Readonly<Record<ImageRatio, number>> = {
  '4x3': 4 / 3,
  '1x1': 1,
};

/* ===========================================================================
   Schema
   =========================================================================== */

const variantSchema = z.object({
  ratio: z.enum(IMAGE_RATIOS),
  role: z.enum(IMAGE_ROLES),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Repo-relative path, e.g. `product-images/desk/graphite-desk-pad-640.webp`. */
  webp: z.string().min(1),
  /** Same crop as JPEG, for `<picture>` fallback. */
  jpeg: z.string().min(1),
  /** Bytes on disk. Lets the media agent audit the ~150KB-per-product budget. */
  bytes: z.number().int().positive(),
});

/** This is the brief's `ProductImageEntry`. `ProductImage` is the API name. */
const productImageSchema = z.object({
  slug: z.string().min(1),
  /** Alt text. Written by the media agent from the product; never generated here. */
  alt: z
    .string()
    .min(1, 'alt text is required; an empty alt is `decorative` on the component, not here.'),
  attribution: z.object({
    sourceUrl: z.url(),
    photographer: z.string().min(1),
    license: z.string().min(1),
  }),
  images: z.array(variantSchema).min(1, 'a product needs at least one image'),
});

export const productImageManifestSchema = z.object({
  version: z.literal(1),
  products: z.record(z.string(), productImageSchema),
});

/* ===========================================================================
   Types
   =========================================================================== */

export type ProductImageVariant = z.output<typeof variantSchema>;
export type ProductImage = z.output<typeof productImageSchema>;
export type ProductImageManifest = z.output<typeof productImageManifestSchema>;

/**
 * Everything a caller needs to render one crop.
 *
 * `srcSet` is WebP and always carries every committed width for that ratio,
 * ascending. `width` and `height` are the intrinsic pixel dimensions of `src`
 * — put them on the element as attributes and the browser reserves the right
 * box before the bytes arrive.
 */
export interface ImageUrls {
  /**
   * The largest committed WebP for this ratio.
   *
   * Note for `<picture>` users: the `<img>` `src` must be the **JPEG**, because
   * that is the fallback for browsers which skipped the WebP `<source>`. Reach
   * for `src` when you are not using `<picture>` — a bare `<img>`, an Open Graph
   * tag, a CSS `background-image`.
   */
  src: string;
  /** Every committed WebP for this ratio, `"{path} {width}w"`, ascending by width. */
  srcSet: string;
  /** JPEG fallback for the same crop. This is what a `<picture>`'s `<img>` uses. */
  jpeg: string;
  /** Intrinsic width of `src`, in pixels. */
  width: number;
  /** Intrinsic height of `src`, in pixels. */
  height: number;
  /** Alt text, verbatim from the manifest. */
  alt: string;
}

/** The lookup surface returned by {@link createImageLookup}. */
export interface ImageLookup {
  /** The whole manifest entry, or `null` when the slug is unknown. */
  getProductImage: (slug: string) => ProductImage | null;
  /** Resolved URLs for one crop, or `null` when the slug or the ratio is missing. */
  getImageUrls: (slug: string, ratio: ImageRatio) => ImageUrls | null;
}

/* ===========================================================================
   Validation
   =========================================================================== */

/**
 * Validate a manifest, then check the invariants Zod cannot express.
 *
 * Two matter in practice:
 *   - a product's `slug` must equal its key, so a mismatch cannot silently ship
 *     one product's photo under another product's name;
 *   - a variant's `width`/`height` must match its declared `ratio`, so the box
 *     the browser reserves is the box the image fills.
 *
 * @throws ConfigurationError naming the product and the field.
 */
export function parseProductImageManifest(input: unknown): ProductImageManifest {
  const result = productImageManifestSchema.safeParse(input);

  if (!result.success) {
    throw new ConfigurationError(
      `product-images/manifest.json is not valid. ${describeIssues(result.error)}. ` +
        'It is a committed source file: fix the manifest rather than relaxing this schema.',
      { details: { problems: result.error.issues.map((issue) => issue.path.join('.')) } },
    );
  }

  const manifest = result.data;

  for (const [key, product] of Object.entries(manifest.products)) {
    if (product.slug !== key) {
      throw new ConfigurationError(
        `product-images/manifest.json: products["${key}"].slug is "${product.slug}". ` +
          "The key and the slug must match, or a product would render another product's photo.",
        { details: { key, slug: product.slug } },
      );
    }

    const seen = new Set<string>();
    for (const variant of product.images) {
      const expected = `${variant.ratio}@${variant.width}`;

      if (seen.has(expected)) {
        throw new ConfigurationError(
          `product-images/manifest.json: products["${key}"].images has two ${variant.ratio} variants ` +
            `at ${variant.width}w. One variant per ratio and width.`,
          { details: { key, ratio: variant.ratio, width: variant.width } },
        );
      }
      seen.add(expected);

      if (Math.abs(variant.width / variant.height - RATIO_VALUE[variant.ratio]) > 0.01) {
        throw new ConfigurationError(
          `product-images/manifest.json: products["${key}"].images declares ${variant.ratio} but is ` +
            `${variant.width}x${variant.height}. Crop it to the declared ratio, or change the ratio.`,
          {
            details: {
              key,
              ratio: variant.ratio,
              width: variant.width,
              height: variant.height,
            },
          },
        );
      }
    }
  }

  return manifest;
}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map(
      (issue) => `${issue.path.length === 0 ? '(root)' : issue.path.join('.')}: ${issue.message}`,
    )
    .join('; ');
}

/**
 * Read and validate the committed manifest.
 *
 * Called once at module load below — that is the loud failure the contract
 * asks for. Exported so a build step can validate the file explicitly.
 */
export function loadProductImageManifest(): ProductImageManifest {
  return parseProductImageManifest(manifestJson);
}

/* ===========================================================================
   Lookup
   =========================================================================== */

/**
 * Build the lookup from a validated manifest.
 *
 * Pure and synchronous, which is what makes the lookup testable against a
 * fixture rather than against whatever happens to be on disk.
 */
export function createImageLookup(manifest: ProductImageManifest): ImageLookup {
  return {
    getProductImage(slug) {
      return manifest.products[slug] ?? null;
    },

    getImageUrls(slug, ratio) {
      const product = manifest.products[slug];
      if (product === undefined) return null;

      const variants = product.images.filter((variant) => variant.ratio === ratio);
      // Ascending, so `src` ends up the largest committed width.
      variants.sort((a, b) => a.width - b.width);

      const largest = variants.at(-1);
      // A product can legitimately have only one crop. Callers get `null` and
      // render their own placeholder — never a broken image.
      if (largest === undefined) return null;

      return {
        src: largest.webp,
        srcSet: variants.map((variant) => `${variant.webp} ${variant.width}w`).join(', '),
        jpeg: largest.jpeg,
        width: largest.width,
        height: largest.height,
        alt: product.alt,
      };
    },
  };
}

/* ===========================================================================
   Module load
   ---------------------------------------------------------------------------
   Validate once, here. A malformed committed manifest throws at module load
   rather than rendering broken images further down the tree.
   =========================================================================== */

const manifest = loadProductImageManifest();
const lookup = createImageLookup(manifest);

/** The validated manifest, for a build-time audit or a test. */
export const productImages: ProductImageManifest = manifest;

/** The manifest entry for `slug`, or `null` when the slug is not in the manifest. */
export const getProductImage: ImageLookup['getProductImage'] = lookup.getProductImage;

/**
 * WebP + JPEG URLs for one crop, or `null` when the slug is unknown **or** the
 * product has no image at that ratio.
 */
export const getImageUrls: ImageLookup['getImageUrls'] = lookup.getImageUrls;
