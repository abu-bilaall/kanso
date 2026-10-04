/**
 * `max-w-<name>` must mean what it says.
 *
 * The bug this pins: Tailwind v4 resolves a named `max-w-<name>` against
 * `--container-<name>` **and** against `--spacing-<name>`, and `--spacing-*` wins
 * when the theme declares it. Kanso's theme declared the Stitch spacing scale
 * under bare names, so `max-w-sm` rendered at 8px instead of 24rem, `max-w-xl` at
 * 40px instead of 36rem, and the catalogue hero line — written as
 * `max-w-xl text-body-lg` — was squashed to the width of a word. A6 filed it as
 * contract request 10; `npm run check:classes` cannot see it, because the class
 * does generate a rule, just with the wrong value, and neither could a test that
 * read `tokens.css` and asserted the token was declared.
 *
 * The decision, made at the integration-3 pass: the Kanso scale is namespaced —
 * `--spacing-k-sm`, so `gap-k-sm` — which takes it out of the namespace the
 * container scale is looked up in. Restating Tailwind's own `--container-*`
 * values in the theme would have been a smaller diff and would have left the
 * same collision waiting for the next scale entry added at 2am. This way
 * `max-w-sm` is 24rem because nothing in the theme competes for the name.
 *
 * Everything below compiles the real stylesheet. Reading the token file would
 * prove the shadowing had been declared, which is exactly the wrong question.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { compileTheme, type ThemeCss } from '../helpers/themeCss';

const ROOT = process.cwd();

/** Every named width a call site in `src/` could reach for, and its real size. */
const NAMED_WIDTHS: ReadonlyArray<[className: string, px: number]> = [
  ['max-w-xs', 320], // 20rem
  ['max-w-sm', 384], // 24rem
  ['max-w-md', 448], // 28rem
  ['max-w-lg', 512], // 32rem
  ['max-w-xl', 576], // 36rem
];

let theme: ThemeCss;

beforeAll(async () => {
  theme = await compileTheme([
    ...NAMED_WIDTHS.map(([className]) => className),
    'max-w-2xl',
    'max-w-3xl',
    'max-w-5xl',
    'max-w-7xl',
    'max-w-prose',
    'gap-k-md',
    'gap-k-lg',
    'px-k-gutter',
    'w-k-rail',
  ]);
}, 60_000);

describe('named max-widths', () => {
  it.each(NAMED_WIDTHS)(
    '%s is %dpx — the container scale, not the spacing scale',
    (className, px) => {
      expect(theme.lengthOf(className, 'max-width')).toBe(px);
    },
  );

  it('leaves the numeric column widths and the prose measure alone', () => {
    // `PageShell`'s three column widths, and the measure every body paragraph
    // uses. `prose` was never a spacing key, so it was the one named width that
    // already worked — and it has to keep working after the rename.
    expect(theme.lengthOf('max-w-2xl', 'max-width')).toBe(672);
    expect(theme.lengthOf('max-w-3xl', 'max-width')).toBe(768);
    expect(theme.lengthOf('max-w-5xl', 'max-width')).toBe(1024);
    expect(theme.lengthOf('max-w-7xl', 'max-width')).toBe(1280);
    expect(theme.ruleFor('max-w-prose')).toContain('max-width');
  });

  it('leaves the Kanso scale reachable under its own namespace', () => {
    // The rename is only correct if the spacing it renamed *from* still
    // resolves: `gap-k-lg` is 24px, the same 24px `--k-space-lg` has always been.
    expect(theme.lengthOf('gap-k-md', 'gap')).toBe(16);
    expect(theme.lengthOf('gap-k-lg', 'gap')).toBe(24);
    expect(theme.lengthOf('px-k-gutter', 'padding-inline')).toBe(16);
    expect(theme.lengthOf('w-k-rail', 'width')).toBe(160);
  });

  it('publishes no un-namespaced spacing entry that could shadow it again', () => {
    // The trap is a later edit adding `--spacing-md` back beside the namespaced
    // ones. It is one line in a stylesheet, so it is worth a test.
    const tokens = readFileSync(join(ROOT, 'apps/web/src/styles/tokens.css'), 'utf8');
    const themeBlock = /@theme inline \{([^}]*)\}/.exec(tokens)?.[1] ?? '';
    const declared = [...themeBlock.matchAll(/--spacing-([\w-]+)\s*:/g)].map(
      (match) => match[1] ?? '',
    );
    expect(declared.filter((name) => !name.startsWith('k-'))).toEqual([]);
  });
});
