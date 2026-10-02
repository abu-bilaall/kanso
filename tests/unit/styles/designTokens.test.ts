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
 * `npm run check:classes` is the wider sweep: every class name in `src/`, not
 * only the ones named here.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from 'tailwindcss';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = process.cwd();

/** Every class name the app composes from a design token, by hand. */
const TOKEN_CLASSES = [
  // Spacing. `md`/`lg`/`xl` were the three that were missing.
  'p-xs',
  'p-sm',
  'p-md',
  'p-lg',
  'p-xl',
  'p-gutter',
  'p-gutter-desktop',
  'p-rail',
  'gap-xs',
  'gap-sm',
  'gap-md',
  'gap-lg',
  'gap-xl',
  'pt-md',
  'pt-xs',
  'pb-xl',
  'w-rail',

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
  'md:pt-lg',
  'md:pb-xl',
  'md:p-md',
  'md:pl-rail',
  'focus:border-hard',
  'focus:font-label',
  'focus:bg-surface-high',
];

let css: string;

/** Every custom property the compiled stylesheet emits, e.g. `--k-space-lg`. */
let customProperties: Record<string, string> = {};

beforeAll(async () => {
  // The real entry stylesheet, minus the @fontsource imports. Those ship woff2
  // files and have nothing to say about which utilities exist.
  const entry = readFileSync(join(ROOT, 'src/styles/index.css'), 'utf8')
    .split('\n')
    .filter((line) => !line.startsWith('@import "@fontsource'))
    .join('\n');

  const readCss = (file: string) => ({
    path: file,
    base: join(file, '..'),
    content: readFileSync(file, 'utf8'),
  });

  const compiler = await compile(entry, {
    base: join(ROOT, 'src/styles'),
    loadStylesheet: async (id, base) =>
      id === 'tailwindcss' || id.startsWith('tailwindcss/')
        ? readCss(
            join(
              ROOT,
              'node_modules/tailwindcss',
              id === 'tailwindcss' ? 'index.css' : id.slice('tailwindcss/'.length),
            ),
          )
        : readCss(join(base, id)),
    loadModule: async () => {
      throw new Error('the stylesheet must not load a module');
    },
  });

  css = compiler.build([...TOKEN_CLASSES, ...COMPARED]);
  customProperties = Object.fromEntries(
    [...css.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)[;}]/g)].map((m) => [
      m[1] as string,
      m[2]?.trim() ?? '',
    ]),
  );
}, 60_000);

/**
 * The rule Tailwind emits for `className`, or `null` if it emits none. The
 * selector is matched loosely because a variant rule carries its own pseudo —
 * `focus:border-hard` compiles to `.focus\:border-hard:focus`.
 */
function ruleFor(className: string): string | null {
  const inCss = className.replace(/[!"#$%&'()*+,./:;<=>?@[\]^`{|}~]/g, (ch) => `\\${ch}`);
  const pattern = inCss.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\.${pattern}[^{}]*\\{([^}]*)\\}`).exec(css)?.[1] ?? null;
}

const UNITS_IN_PX: Record<string, number> = { px: 1, rem: 16 };

/**
 * The length a utility actually renders at, in px, or `null` if it is not a
 * length this can measure. Resolves `var()` and the one `calc()` shape
 * Tailwind's numeric spacing scale produces.
 */
function lengthOf(className: string, property: string): number | null {
  const declared = new RegExp(`(?:^|[;{])\\s*${property}\\s*:\\s*([^;]+)`).exec(
    ruleFor(className) ?? '',
  );
  return declared === null ? null : toPx(declared[1] ?? '', 0);
}

function toPx(value: string, depth: number): number | null {
  if (depth > 6) return null;
  const trimmed = value.trim();

  const reference = /var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)/.exec(trimmed);
  if (reference !== null) {
    const resolved = customProperties[reference[1] as string];
    return resolved === undefined ? null : toPx(trimmed.replace(reference[0], resolved), depth + 1);
  }

  const product = /^calc\(\s*(-?[\d.]+)(px|rem)\s*\*\s*(-?[\d.]+)\s*\)$/.exec(trimmed);
  if (product !== null) {
    return Number(product[1]) * (UNITS_IN_PX[product[2] as string] ?? 1) * Number(product[3]);
  }

  const length = /^(-?[\d.]+)(px|rem)$/.exec(trimmed);
  return length === null ? null : Number(length[1]) * (UNITS_IN_PX[length[2] as string] ?? 1);
}

describe('design tokens', () => {
  it('generates a real rule for every class name these assertions look at', () => {
    const all = [...TOKEN_CLASSES, ...COMPARED];
    expect(all.filter((className) => ruleFor(className) === null)).toEqual([]);
  });

  it('sizes the named scale entries the way Tailwind sizes the numeric ones', () => {
    // 16px / 24px / 40px — `--k-space-md`, `-lg` and `-xl`.
    expect(lengthOf('pt-md', 'padding-top')).toBe(16);
    expect(lengthOf('p-md', 'padding')).toBe(16);
    expect(lengthOf('gap-md', 'gap')).toBe(16);
    expect(lengthOf('p-lg', 'padding')).toBe(24);
    expect(lengthOf('gap-lg', 'gap')).toBe(24);
    expect(lengthOf('p-xl', 'padding')).toBe(40);
  });

  it('gives the shell and the rail the vertical rhythm they were written for', () => {
    // `PageShell`: 16px above the fold on mobile, 24px and 40px at `md:`.
    // `DesktopRail`: 16px of padding, 24px between the main links, 16px between
    // the categories.
    expect(lengthOf('md:pt-lg', 'padding-top')).toBe(lengthOf('p-6', 'padding'));
    expect(lengthOf('md:pb-xl', 'padding-bottom')).toBe(lengthOf('p-10', 'padding'));
    expect(lengthOf('md:p-md', 'padding')).toBe(lengthOf('p-4', 'padding'));
    expect(lengthOf('gap-lg', 'gap')).toBe(24);
    expect(lengthOf('gap-md', 'gap')).toBe(16);
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
