/**
 * Compile the application's real stylesheet and measure what a class name does.
 *
 * `apps/web/src/styles/index.css` and everything it imports, run through the Tailwind
 * engine, is the only honest source for "what does `gap-k-md` render at". A
 * test that reads `tokens.css` and asserts the token is declared proves the
 * token exists; it does not prove the class resolves, and it cannot see a class
 * that resolves to the *wrong* length — which is exactly how the named widths
 * were shadowed for two integration passes.
 *
 * Shared by `tests/unit/styles/`, so the loader and the length maths are
 * defined once and cannot drift between the two files that depend on them.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from 'tailwindcss';

const ROOT = process.cwd();

export interface ThemeCss {
  /** The compiled stylesheet. */
  readonly css: string;
  /**
   * The rule Tailwind emits for `className`, or `null` if it emits none. The
   * selector is matched loosely because a variant rule carries its own pseudo —
   * `focus:border-hard` compiles to `.focus\:border-hard:focus`.
   */
  ruleFor(className: string): string | null;
  /**
   * The length a utility actually renders at, in px, or `null` if it is not a
   * length this can measure. Resolves `var()` and the one `calc()` shape
   * Tailwind's numeric spacing scale produces.
   */
  lengthOf(className: string, property: string): number | null;
}

const UNITS_IN_PX: Record<string, number> = { px: 1, rem: 16 };

export async function compileTheme(candidates: readonly string[]): Promise<ThemeCss> {
  // The real entry stylesheet, minus the @fontsource imports. Those ship woff2
  // files and have nothing to say about which utilities exist.
  const entry = readFileSync(join(ROOT, 'apps/web/src/styles/index.css'), 'utf8')
    .split('\n')
    .filter((line) => !line.startsWith('@import "@fontsource'))
    .join('\n');

  const readCss = (file: string) => ({
    path: file,
    base: join(file, '..'),
    content: readFileSync(file, 'utf8'),
  });

  const compiler = await compile(entry, {
    base: join(ROOT, 'apps/web/src/styles'),
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

  const css = compiler.build([...candidates]);
  const customProperties: Record<string, string> = Object.fromEntries(
    [...css.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)[;}]/g)].map((m) => [
      m[1] as string,
      m[2]?.trim() ?? '',
    ]),
  );

  function ruleFor(className: string): string | null {
    const inCss = className.replace(/[!"#$%&'()*+,./:;<=>?@[\]^`{|}~]/g, (ch) => `\\${ch}`);
    const pattern = inCss.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\.${pattern}[^{}]*\\{([^}]*)\\}`).exec(css)?.[1] ?? null;
  }

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
      return resolved === undefined
        ? null
        : toPx(trimmed.replace(reference[0], resolved), depth + 1);
    }

    const product = /^calc\(\s*(-?[\d.]+)(px|rem)\s*\*\s*(-?[\d.]+)\s*\)$/.exec(trimmed);
    if (product !== null) {
      return Number(product[1]) * (UNITS_IN_PX[product[2] as string] ?? 1) * Number(product[3]);
    }

    const length = /^(-?[\d.]+)(px|rem)$/.exec(trimmed);
    return length === null ? null : Number(length[1]) * (UNITS_IN_PX[length[2] as string] ?? 1);
  }

  return { css, ruleFor, lengthOf };
}
