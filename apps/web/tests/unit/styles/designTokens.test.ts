/**
 * The `@theme` block *is* the design system, and in Tailwind v4 a class name
 * that is not in it is not a class — it is a string that renders to nothing,
 * silently.
 *
 * That is not hypothetical. `PageShell` shipped `pt-md`, `md:pt-lg`, `md:pb-xl`
 * and `gap-lg`; the theme declared only `--spacing-xs` and `--spacing-sm`, so
 * every page in the application rendered with no top padding and no gap between
 * stacked sections, and nothing anywhere said so. `font-label` and
 * `focus:border-hard` were the same bug wearing different clothes.
 *
 * These assertions compile the project's real entry stylesheet — `src/styles/
 * index.css` and everything it imports — and then measure. A class name that
 * produces no rule fails here rather than in a screenshot nobody looks at, and a
 * named scale entry that resolves to a different length than the numeric one it
 * is meant to extend fails here too, because two spacing systems that agree by
 * luck are two spacing systems.
 *
 * The scale entries are `k-` namespaced (`gap-k-md`, `pt-k-md`) since the
 * integration-3 pass; that decision is pinned by `containerWidths.test.ts`,
 * which is where the reason for it lives.
 *
 * `npm run check:classes` is the wider sweep: every class name in `src/`, not
 * only the ones named here.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { compileTheme, type ThemeCss } from '../helpers/themeCss';

/** Every class name the app composes from a design token, by hand. */
const TOKEN_CLASSES = [
  // Spacing. `md`/`lg`/`xl` were the three that were missing.
  'p-k-xs',
  'p-k-sm',
  'p-k-md',
  'p-k-lg',
  'p-k-xl',
  'p-k-gutter',
  'p-k-gutter-desktop',
  'p-k-rail',
  'gap-k-xs',
  'gap-k-sm',
  'gap-k-md',
  'gap-k-lg',
  'gap-k-xl',
  'pt-k-md',
  'pt-k-xs',
  'pb-k-xl',
  'w-k-rail',

  // Colour.
  'bg-paper',
  'bg-surface-lowest',
  'bg-surface-low',
  'bg-surface-container',
  'bg-surface-high',
  'bg-surface-highest',
  'bg-surface-dim',
  'bg-ink',
  'bg-graphite',
  'bg-accent',
  'bg-hairline',
  'bg-danger',
  'bg-danger-surface',
  'bg-inverse',
  'text-ink',
  'text-ink-muted',
  'text-ink-subtle',
  'text-ink-on-accent',
  'text-ink-on-primary',
  'text-accent-deep',
  'text-accent-deep-dim',
  'text-danger',
  'text-danger-ink',
  'text-inverse-text',
  'border-ink',
  'border-hairline',
  'border-accent',
  'border-danger',

  // Type. `font-label` did not exist; Stitch calls that style `label-lg` and
  // puts Archivo on it, which is `--font-sans` under the Kanso name.
  'font-sans',
  'font-display',
  'font-editorial',
  'font-label',
  'text-meta',
  'text-body',
  'text-body-lg',
  'text-label',
  'text-heading',
  'text-hero',

  // Geometry, and the three shared utilities.
  'rounded-tight',
  'rounded-component',
  'rounded-panel',
  'border-hard',
  'tap-target',
  'transition-kanso',
];

/**
 * Built alongside the token classes so the measurements below have something
 * to measure against: the numeric-scale and variant forms of the same
 * utilities. `focus:*` is `PageShell`'s skip link and `Input`/`Select`.
 */
const COMPARED = [
  'p-4',
  'p-6',
  'p-10',
  'gap-4',
  'gap-6',
  'md:pt-k-lg',
  'md:pb-k-xl',
  'md:p-k-md',
  'md:pl-k-rail',
  'focus:border-hard',
  'focus:font-label',
  'focus:bg-surface-high',
];

let theme: ThemeCss;

beforeAll(async () => {
  theme = await compileTheme([...TOKEN_CLASSES, ...COMPARED]);
}, 60_000);

const ruleFor = (className: string) => theme.ruleFor(className);
const lengthOf = (className: string, property: string) => theme.lengthOf(className, property);

describe('design tokens', () => {
  it('generates a real rule for every class name these assertions look at', () => {
    const all = [...TOKEN_CLASSES, ...COMPARED];
    expect(all.filter((className) => ruleFor(className) === null)).toEqual([]);
  });

  it('sizes the named scale entries the way Tailwind sizes the numeric ones', () => {
    // 16px / 24px / 40px — `--k-space-md`, `-lg` and `-xl`.
    expect(lengthOf('pt-k-md', 'padding-top')).toBe(16);
    expect(lengthOf('p-k-md', 'padding')).toBe(16);
    expect(lengthOf('gap-k-md', 'gap')).toBe(16);
    expect(lengthOf('p-k-lg', 'padding')).toBe(24);
    expect(lengthOf('gap-k-lg', 'gap')).toBe(24);
    expect(lengthOf('p-k-xl', 'padding')).toBe(40);
  });

  it('gives the shell and the rail the vertical rhythm they were written for', () => {
    // `PageShell`: 16px above the fold on mobile, 24px and 40px at `md:`.
    // `DesktopRail`: 16px of padding, 24px between the main links, 16px between
    // the categories.
    expect(lengthOf('md:pt-k-lg', 'padding-top')).toBe(lengthOf('p-6', 'padding'));
    expect(lengthOf('md:pb-k-xl', 'padding-bottom')).toBe(lengthOf('p-10', 'padding'));
    expect(lengthOf('md:p-k-md', 'padding')).toBe(lengthOf('p-4', 'padding'));
    expect(lengthOf('gap-k-lg', 'gap')).toBe(24);
    expect(lengthOf('gap-k-md', 'gap')).toBe(16);
  });

  it('gives the shared utilities their variants, which a bare rule cannot', () => {
    // Declared as `@utility` rather than as a rule inside `@layer utilities`.
    // `PageShell`'s skip link has carried `focus:border-hard` since Foundation;
    // against a bare rule that is not a class at all, and the link showed no
    // hard edge when it took focus.
    expect(ruleFor('focus:border-hard')).toContain('border-width');
    expect(ruleFor('focus:font-label')).not.toBeNull();
    // `Input` and `Select` focused background. It read `bg-surface-container-high`,
    // which is the Stitch token name; Kanso calls that colour `surface-high`, so
    // the class resolved to nothing and a focused field never changed colour.
    expect(ruleFor('focus:bg-surface-high')).toContain('background-color');
  });

  it('resolves font-label to the one face it was always meant to be', () => {
    // Stitch's own config puts Archivo on both `body-lg` and `label-lg`, so
    // `font-label` is that same face under a name that says what it is for. It
    // must never become a second family: every label, button and money figure
    // in the shop would change face silently.
    expect(ruleFor('font-label')).toContain('var(--font-sans)');
  });
});
