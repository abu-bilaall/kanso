/**
 * Contract tests for `<ProductImage>`.
 *
 * The manifest is mocked, so these assert the component's own guarantees rather
 * than whatever the media agent has committed: the `<picture>` structure, the
 * explicit dimensions that stop layout shift, the alt-text default, and the
 * no-broken-image fallback.
 */

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// Static import, and it binds the double: Vitest hoists `vi.mock` above this
// file's imports, exactly as it does for the hook suites.
import { ProductImage } from '@/components/media/ProductImage';
import type { ImageUrls } from '@/lib/images';

// `vi.mock` is hoisted above the imports, so the double has to be created with
// `vi.hoisted` — a plain top-level `vi.fn()` would not exist yet when the factory
// runs.
const { getImageUrls } = vi.hoisted(() => ({
  getImageUrls: vi.fn<(slug: string, ratio: string) => ImageUrls | null>(),
}));

vi.mock('@/lib/images', () => ({ getImageUrls }));

const RESOLVED: ImageUrls = {
  src: 'product-images/desk/steel-rule-4x3-640.webp',
  srcSet:
    'product-images/desk/steel-rule-4x3-320.webp 320w, ' +
    'product-images/desk/steel-rule-4x3-640.webp 640w',
  jpeg: 'product-images/desk/steel-rule-4x3-640.jpg',
  width: 640,
  height: 480,
  alt: 'Milled steel rule on raw concrete.',
};

beforeEach(() => {
  getImageUrls.mockReset();
  getImageUrls.mockReturnValue(RESOLVED);
});

describe('ProductImage', () => {
  it('renders a <picture> with a WebP source and a JPEG fallback', () => {
    render(<ProductImage slug="steel-rule" />);

    const source = document.querySelector('source');
    const img = screen.getByRole('img');

    expect(source?.getAttribute('type')).toBe('image/webp');
    expect(source?.getAttribute('srcset')).toBe(RESOLVED.srcSet);
    // Inside <picture> the <img> src is the fallback for browsers that skipped
    // the WebP <source>, so it must be the JPEG — not the WebP.
    expect(img.getAttribute('src')).toBe(RESOLVED.jpeg);
  });

  it('sets explicit width and height so the browser reserves the box', () => {
    render(<ProductImage slug="steel-rule" />);

    const img = screen.getByRole('img');
    expect(img.getAttribute('width')).toBe('640');
    expect(img.getAttribute('height')).toBe('480');
  });

  it('reserves the same box on the wrapper, before the bytes arrive', () => {
    const { container } = render(<ProductImage slug="steel-rule" ratio="1x1" />);

    const frame = container.firstElementChild;
    expect(frame?.getAttribute('style')).toContain('aspect-ratio: 1 / 1');
  });

  it('takes alt text from the manifest', () => {
    render(<ProductImage slug="steel-rule" />);
    expect(screen.getByRole('img').getAttribute('alt')).toBe(RESOLVED.alt);
  });

  it('hides a decorative image only when explicitly asked', () => {
    const { container, rerender } = render(<ProductImage slug="steel-rule" />);
    expect(container.querySelector('img')?.getAttribute('aria-hidden')).toBeNull();

    rerender(<ProductImage slug="steel-rule" decorative />);
    // Queried from the DOM, not by role: `aria-hidden` takes the image out of
    // the accessibility tree, which is the whole point.
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('');
    expect(container.querySelector('img')?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('treats an empty alt as decorative rather than announcing nothing', () => {
    getImageUrls.mockReturnValue({ ...RESOLVED, alt: '' });
    const { container } = render(<ProductImage slug="steel-rule" />);

    expect(container.querySelector('img')?.getAttribute('alt')).toBe('');
  });

  it('forwards sizes to the WebP source when the caller supplies it', () => {
    render(<ProductImage slug="steel-rule" sizes="(min-width: 768px) 33vw, 100vw" />);
    expect(document.querySelector('source')?.getAttribute('sizes')).toBe(
      '(min-width: 768px) 33vw, 100vw',
    );
  });

  it('asks for the 4x3 crop by default and honours an explicit ratio', () => {
    const { rerender } = render(<ProductImage slug="steel-rule" />);
    expect(getImageUrls).toHaveBeenCalledWith('steel-rule', '4x3');

    rerender(<ProductImage slug="steel-rule" ratio="1x1" />);
    expect(getImageUrls).toHaveBeenCalledWith('steel-rule', '1x1');
  });

  it('lazy-loads by default', () => {
    render(<ProductImage slug="steel-rule" />);
    expect(screen.getByRole('img').getAttribute('loading')).toBe('lazy');
    expect(screen.getByRole('img').getAttribute('fetchpriority')).toBeNull();
  });

  it('makes an above-the-fold hero eager and high priority', () => {
    render(<ProductImage slug="steel-rule" priority />);
    // `priority` overrides the default `lazy`: an image that asks to be
    // prioritised must not also be told to wait.
    expect(screen.getByRole('img').getAttribute('loading')).toBe('eager');
    expect(screen.getByRole('img').getAttribute('fetchpriority')).toBe('high');
  });

  it('honours an explicit eager request without a priority hint', () => {
    render(<ProductImage slug="steel-rule" lazy={false} />);
    expect(screen.getByRole('img').getAttribute('loading')).toBe('eager');
  });

  /* --- the fallback that matters ---------------------------------------- */

  it('renders a neutral panel of the right size when the manifest has no image', () => {
    getImageUrls.mockReturnValue(null);

    const { container } = render(<ProductImage slug="graphite-desk-pad" ratio="4x3" />);

    // No broken-image glyph, and nothing for a screen reader to read out.
    expect(screen.queryByRole('img')).toBeNull();
    const frame = container.firstElementChild;
    expect(frame?.getAttribute('style')).toContain('aspect-ratio: 4 / 3');
    expect(frame?.textContent).toContain('No image');
  });

  it('keeps the fallback the same size as the image it replaces, so nothing jumps', () => {
    getImageUrls.mockReturnValue(null);

    const { container } = render(<ProductImage slug="graphite-desk-pad" ratio="1x1" />);

    const frame = container.firstElementChild;
    expect(frame?.className).toContain('w-full');
    expect(frame?.getAttribute('style')).toContain('aspect-ratio: 1 / 1');
  });
});
