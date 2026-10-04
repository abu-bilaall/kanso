/**
 * Which class names in `src/` generate no CSS?
 *
 * In Tailwind v4 a class name that is not in `@theme` is not a class, it is a
 * string that renders to nothing. `PageShell` shipped `pt-md`, `md:pt-lg`,
 * `md:pb-xl` and `gap-lg` while the theme declared only `--spacing-xs` and
 * `--spacing-sm`, so every page in the shop rendered with no top padding and no
 * gap between stacked sections and nothing said so. `font-label`,
 * `focus:border-hard` and `focus:bg-surface-container-high` were the same bug.
 *
 * This compiles the project's own stylesheet with the project's own Tailwind
 * and reports every class name the source uses for which the engine emits
 * nothing. Exits non-zero if there are any.
 *
 *   npm run check:classes
 */

import fs from 'node:fs';
import path from 'node:path';
import { Scanner } from '@tailwindcss/oxide';
import { compile } from 'tailwindcss';

const root = process.cwd();
const srcDir = path.join(root, 'apps/web/src');
const stylesDir = path.join(srcDir, 'styles');

/** Strips comments: prose is not a class name, and Tailwind scans it anyway. */
const withoutComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');

const walk = (dir) => {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
};

/**
 * Every string literal reachable from a `className` attribute, including the
 * static text of a template literal and the literals inside a `${…}`, which is
 * where a conditional class actually lives. Reading the source beats matching
 * strings, because a `className={…}` value is an expression that nests.
 *
 * Collection stops inside an object literal that is a call's argument, because
 * that is `buttonClasses({ variant: 'accent' })`, where `'accent'` is a variant
 * name rather than a colour class.
 */
function classNameLiterals(text) {
  const literals = [];

  const readQuoted = (start) => {
    const quote = text[start];
    let i = start + 1;
    while (i < text.length && text[i] !== quote) i += text[i] === '\\' ? 2 : 1;
    return { value: text.slice(start + 1, i), end: i + 1 };
  };

  // Only the static text of a template is a class; `${…}` chooses between class
  // lists, and `readExpression` collects the branches.
  const readTemplate = (start, collect) => {
    let i = start + 1;
    let chunkStart = i;
    while (i < text.length && text[i] !== '`') {
      if (text[i] === '\\') {
        i += 2;
      } else if (text[i] === '$' && text[i + 1] === '{') {
        if (collect) literals.push(text.slice(chunkStart, i));
        i = readExpression(i + 1, collect).end;
        chunkStart = i;
      } else {
        i += 1;
      }
    }
    if (collect) literals.push(text.slice(chunkStart, i));
    return i + 1;
  };

  function readExpression(start, collect = true) {
    let i = start + 1;
    while (i < text.length) {
      const ch = text[i];
      if (ch === '}') return { end: i + 1 };
      if (ch === '{') {
        const isArgument = text
          .slice(start + 1, i)
          .trimEnd()
          .endsWith('(');
        i = readExpression(i, collect && !isArgument).end;
      } else if (ch === "'" || ch === '"') {
        const read = readQuoted(i);
        // `size === 'sm'` compares a size name; a class name is never a
        // comparison operand.
        const isComparison = /(?:===|==|!==|!=)$/.test(text.slice(start + 1, i).trimEnd());
        if (collect && !isComparison) literals.push(read.value);
        i = read.end;
      } else if (ch === '`') {
        i = readTemplate(i, collect);
      } else {
        i += 1;
      }
    }
    return { end: i };
  }

  const attribute = /\bclassName\s*=\s*/g;
  for (let match = attribute.exec(text); match !== null; match = attribute.exec(text)) {
    const start = match.index + match[0].length;
    if (text[start] === '{') {
      readExpression(start);
    } else if (text[start] === '"' || text[start] === "'") {
      literals.push(readQuoted(start).value);
    }
  }
  return literals;
}

const classNames = new Set();

/**
 * The other place class names live: a module-level constant, joined and spread
 * into a `className` at the element. `CONTROL_CLASSES` in `Input`, the variant
 * and size maps in `Button`, `WIDTH_CLASSES` in `PageShell`. Collect the string
 * literals of every `const …CLASSES… = …;` statement, which is a name the
 * codebase already uses for exactly this.
 */
function classConstLiterals(text) {
  const literals = [];
  const declaration = /\bconst\s+[A-Za-z0-9_]*CLASS(?:ES)?\s*(?::[^=]+)?=/g;

  for (let match = declaration.exec(text); match !== null; match = declaration.exec(text)) {
    let i = match.index + match[0].length;
    let depth = 0;
    while (i < text.length) {
      const ch = text[i];
      if (ch === '[' || ch === '{' || ch === '(') depth += 1;
      else if (ch === ']' || ch === '}' || ch === ')') depth -= 1;
      else if (ch === ';' && depth <= 0) break;
      else if (ch === "'" || ch === '"') {
        const quote = ch;
        let j = i + 1;
        while (j < text.length && text[j] !== quote) j += text[j] === '\\' ? 2 : 1;
        const value = text.slice(i + 1, j);
        if (/^[a-z0-9:[\]()/%#!,_.-]+(\s+[a-z0-9:[\]()/%#!,_.-]+)*$/.test(value)) {
          literals.push(value);
        }
        i = j + 1;
        continue;
      }
      i += 1;
    }
  }
  return literals;
}
const add = (literal) => {
  for (const token of literal.split(/\s+/)) if (token) classNames.add(token);
};

for (const file of walk(srcDir)) {
  const text = withoutComments(fs.readFileSync(file, 'utf8'));
  for (const literal of classNameLiterals(text)) add(literal);
  for (const literal of classConstLiterals(text)) add(literal);
}

// The engine's own extractor, over the same tree, so a token the app really uses
// is compared against a candidate Tailwind was actually offered.
const scannerCandidates = new Set(
  new Scanner({
    sources: [{ base: srcDir, pattern: '**/*.{ts,tsx,html}', negated: false }],
  }).scan(),
);
const candidates = [...classNames].filter((name) => scannerCandidates.has(name));

// The real entry stylesheet, minus the @fontsource imports. Those ship woff2
// files and have nothing to say about which utilities exist.
const entry = fs
  .readFileSync(path.join(stylesDir, 'index.css'), 'utf8')
  .split('\n')
  .filter((line) => !line.startsWith('@import "@fontsource'))
  .join('\n');

const readCss = (file) => ({
  path: file,
  base: path.dirname(file),
  content: fs.readFileSync(file, 'utf8'),
});

const compiler = await compile(entry, {
  base: stylesDir,
  loadStylesheet: async (id, base) => {
    if (id === 'tailwindcss' || id.startsWith('tailwindcss/')) {
      const name = id === 'tailwindcss' ? 'index.css' : id.slice('tailwindcss/'.length);
      return readCss(path.join(root, 'node_modules/tailwindcss', name));
    }
    return readCss(path.resolve(base, id));
  },
  loadModule: async () => {
    throw new Error('the stylesheet must not load a module');
  },
});

const built = compiler.build(candidates);

const escapeForRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cssEscaped = (name) => name.replace(/[!"#$%&'()*+,./:;<=>?@[\]^`{|}~]/g, (ch) => `\\${ch}`);

const dead = candidates.filter((name) => {
  const needle = new RegExp(`${escapeForRegex(`.${cssEscaped(name)}`)}(?![A-Za-z0-9_\\\\-])`);
  return !needle.test(built);
});

console.log(
  `class names used in apps/web/src/: ${classNames.size}   compiled css: ${built.length} bytes`,
);
console.log(`\nDEAD — used as a class, generates nothing (${dead.length}):`);
for (const name of dead.sort()) console.log(`  ${name}`);

if (process.argv.includes('--dump-css')) fs.writeFileSync('/tmp/kanso-built.css', built);

process.exitCode = dead.length === 0 ? 0 : 1;
