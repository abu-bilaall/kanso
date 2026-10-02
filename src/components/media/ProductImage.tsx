/**
 * ProductImage.
 *
 * Renders one product crop from `product-images/manifest.json` via
 * {@link getImageUrls}. Every caller in the storefront, cart, checkout and
 * account uses this rather than an `<img>` of their own, so the loading and
 * missing-image behaviour is decided once.
 *
 * ## The three states
 *
 * 1. **Resolved** — a `<picture>` with the WebP source and a JPEG fallback.
 * 2. **Not in the manifest** — a neutral panel of the same size. Never a
 *    broken-image glyph, and never a box that changes size once you find out.
 * 3. **Still decoding** — the image is transparent until it paints, over a
 *    neutral surface, so a slow network shows a considered block rather than a
 *    flash of nothing.
 *
 * ## Layout stability is not optional
 *
 * The resolved `<img>` carries explicit `width`/`height` attributes and the
 * wrapper carries the matching `aspect-ratio`, so the browser reserves the exact
 * box before the bytes arrive. That is the difference between a catalogue grid
 * that settles and one that jumps while it loads — and it is why
 * `getImageUrls` returns dimensions rather than a bare string.
 *
 * ## Alt text
 *
 * Alt comes from the manifest and is used by default. `decorative` is the
 * **opt-in** escape hatch for a genuinely redundant image (a thumbnail beside
 * the product name that is already in text) and sets `alt=""` plus
 * `aria-hidden`. It is not the default, because almost every product photo here
 * carries information.
 */

import type { CSSProperties } from 'react';
import { getImageUrls, type ImageRatio } from '@/lib/images';

/** The ratio PLAN §4 fixes for the catalogue's main grid. */
const DEFAULT_RATIO: ImageRatio = '4x3';

/** `4x3` -> `4 / 3`. Numeric `aspect-ratio` wants a fraction, not a label. */
const ASPECT: Readonly<Record<ImageRatio, string>> = {
  '4x3': '4 / 3',
  '1x1': '1 / 1',
};

export interface ProductImageProps {
  /** Product slug, matching `products.image_path`'s source of truth in the manifest. */
  slug: string;
  /** Which crop to render. Defaults to `'4x3'`, the main grid ratio. */
  ratio?: ImageRatio;
  /**
   * Responsive hint passed straight to `sizes`, e.g. `"(min-width: 768px) 33vw, 100vw"`.
   * Without it the browser assumes the image fills the viewport, which makes it
   * pick a larger variant than it needs on a dense grid.
   */
  sizes?: string;
  /**
   * `alt` from the manifest. Pass `decorative` instead of overriding this —
   * hand-written alt drifts from what the manifest says.
   */
  alt?: string;
  /**
   * Mark the image as decorative: empty alt plus `aria-hidden`. Opt-in, for an
   * image that genuinely repeats adjacent text.
   */
  decorative?: boolean;
  /** Native lazy loading. Default `true`; set `false` for an above-the-fold hero. */
  lazy?: boolean;
  /** Set `true` to reserve the box while waiting for the manifest to grow. */
  priority?: boolean;
  /** Extra classes on the wrapper. Use for grid placement and border treatment. */
  className?: string;
  /** Forwarded to the `<img>`. Use for `data-*` and test hooks. */
  imgProps?: React.ImgHTMLAttributes<HTMLImageElement>;
}

/**
 * The neutral stand-in. Same box as the real image, drawn from the token ramp —
 * no glyph, no icon, nothing that says "broken".
 */
function ImageFallback({ ratio, className }: { ratio: ImageRatio; className: string }) {
  return (
    <div
      aria-hidden
      role="presentation"
      style={{ aspectRatio: ASPECT[ratio] }}
      className={[
        'flex w-full items-end justify-end rounded-component border-hard border-hairline',
        'bg-surface-container p-2',
        className,
      ].join(' ')}
    >
      <span className="font-editorial text-[10px] uppercase tracking-widest text-ink-subtle">
        No image
      </span>
    </div>
  );
}

export function ProductImage({
  slug,
  ratio = DEFAULT_RATIO,
  sizes,
  alt,
  decorative = false,
  lazy = true,
  priority = false,
  className = '',
  imgProps,
}: ProductImageProps) {
  const resolved = getImageUrls(slug, ratio);

  if (resolved === null) {
    return <ImageFallback ratio={ratio} className={className} />;
  }

  // `src` is deliberately not used here. Inside `<picture>`, the `<img>` `src` is
  // the fallback for browsers that skipped the WebP `<source>`, so it must be a
  // format every browser has. `src` exists for callers not using `<picture>` —
  // social cards, CSS backgrounds — and is documented as such on `ImageUrls`.
  const { srcSet, jpeg, width, height, alt: manifestAlt } = resolved;
  const accessibleName = alt ?? manifestAlt;
  const isDecorative = decorative || accessibleName.trim() === '';

  // The wrapper reserves the box; the attributes give the browser the intrinsic
  // ratio. Both, because either alone leaves a window for layout shift.
  const frameStyle: CSSProperties = { aspectRatio: ASPECT[ratio] };

  return (
    <div style={frameStyle} className={`w-full overflow-hidden bg-surface-container ${className}`}>
      <picture>
        <source type="image/webp" srcSet={srcSet} {...(sizes === undefined ? {} : { sizes })} />
        <img
          {...imgProps}
          src={jpeg}
          width={width}
          height={height}
          alt={isDecorative ? '' : accessibleName}
          aria-hidden={isDecorative || undefined}
          // `priority` wins over `lazy`. Two knobs that fight each other are a
          // footgun: an above-the-fold hero that asks to be prioritised and is
          // told to lazy-load is the browser ignoring both.
          loading={lazy && !priority ? 'lazy' : 'eager'}
          decoding="async"
          fetchPriority={priority ? 'high' : undefined}
          className="h-full w-full object-cover"
        />
      </picture>
    </div>
  );
}
