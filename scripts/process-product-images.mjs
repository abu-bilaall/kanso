#!/usr/bin/env node
/**
 * Product image pipeline — stage one of two.
 *
 * Reads the masters in `product-images/_masters/`, crops each one to the two
 * ratios the UI actually uses, exports WebP + JPEG, and records what it wrote in
 * `.cache/product-images-build.json`.
 *
 * It does **not** write `product-images/manifest.json`. The manifest carries
 * the public URL of each derivative in Storage, so it can only be written after
 * the upload, by `scripts/upload-images.ts`, from the URLs the bucket returns.
 * The two stages share this file as the record of what exists on disk.
 *
 * ## What it emits, and nothing else
 *
 *   4:3 main   640w   WebP + JPEG   catalogue cards, product detail
 *   1:1 thumb  320w   WebP + JPEG   cart lines, gallery thumbs
 *
 * The 1600w and 800w variants PLAN §4 once contemplated are cut: they double
 * the committed weight for bytes no surface in V1 requests. `srcSet` in
 * `src/lib/images.ts` reads whatever widths the manifest commits, so adding one
 * back later is a manifest edit plus a re-run, not a code change.
 *
 * ## Where the files go
 *
 * `public/product-images/<category>/`. Vite copies `public/**` into `dist/` and
 * serves it at the site root, so these are committed, auditable, and readable
 * from the repository without a Storage round trip. The manifest points at
 * Storage; this is the local copy, not the one the browser loads.
 *
 * ## Re-cropping without refetching
 *
 * The per-slug focal point and zoom live in `scripts/product-image-crops.json`,
 * not in this script. A badly framed master is a five-second edit to one number
 * and a re-run; the photograph is never downloaded again.
 *
 * ## Idempotent
 *
 * A derivative is re-rendered only when it is missing, when the master is newer
 * than it, or when the crop parameters for that slug and ratio changed. Re-runs
 * are therefore fast, and a focus change is never silently skipped. State lives
 * in `.cache/product-images-build.json`, which is gitignored.
 *
 * ## Why ImageMagick and not sharp
 *
 * PLAN §4 freezes `package.json`, and `sharp` does not resolve in this
 * repository — it is neither a declared nor an installed dependency. ImageMagick
 * 7 is already required by `scripts/fetch-product-image.sh`, so using it adds
 * no dependency and no new tool for the human to install.
 *
 * Usage:
 *   node scripts/process-product-images.mjs                 every product
 *   node scripts/process-product-images.mjs --slug steel-rule
 *   node scripts/process-product-images.mjs --force         re-render everything
 *   node scripts/process-product-images.mjs --check         verify, write nothing
 */

import { execFile } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const MASTERS = join(ROOT, 'product-images', '_masters');

/**
 * Derivatives live under `public/`, not beside the manifest: Vite copies
 * `public/**` into `dist/` and serves it at the site root.
 */
const DERIVATIVES = join(PUBLIC, 'product-images');

const CONFIG = join(ROOT, 'scripts', 'product-image-crops.json');
const BUILD = join(ROOT, '.cache', 'product-images-build.json');

/**
 * The two crops the UI uses. `width` is the exported width; `height` is derived
 * here and asserted against the bytes on disk after rendering, because a ratio
 * that drifts by a pixel is a layout shift in the catalogue grid.
 */
const VARIANTS = [
  { ratio: '4x3', num: 4, den: 3, role: 'main', width: 640 },
  { ratio: '1x1', num: 1, den: 1, role: 'thumb', width: 320 },
];

const WEBP_QUALITY = 82;
const JPEG_QUALITY = 85;

/**
 * JPEG fallback: 4:4:4 chroma, because a rule's graduations and a notebook's
 * dot grid are exactly the fine edges chroma subsampling smears first.
 */
const JPEG_SAMPLING = '4:4:4';

const args = parseArgs(process.argv.slice(2));

function parseArgs(argv) {
  const out = { slug: null, force: false, check: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--slug') {
      i += 1;
      out.slug = argv[i];
    } else if (arg === '--force') out.force = true;
    else if (arg === '--check') out.check = true;
    else die(`unknown argument: ${arg}`);
  }

  if (out.slug !== null && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(out.slug)) {
    die(`--slug must be lowercase kebab-case, got: ${out.slug}`);
  }
  return out;
}

function die(message) {
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
}

/* ===========================================================================
   Geometry
   =========================================================================== */

/**
 * The largest `num:den` rectangle inside a `w`x`h` source, shrunk by `zoom` and
 * centred on `focus`, then clamped so it never runs off an edge.
 *
 * The width is rounded to a multiple of `den` first. Without that, a 4:3 crop
 * off an odd source width is one pixel off ratio, and
 * `parseProductImageManifest` rejects a manifest whose declared ratio and pixel
 * dimensions disagree by more than 0.01 — the check exists to stop exactly that
 * layout shift, so the crop should never trip it.
 */
function computeCrop(w, h, variant, focus, zoom) {
  const maxWidth = Math.min(w, Math.floor((h * variant.num) / variant.den));
  const cropWidth = Math.max(
    variant.den,
    Math.floor((maxWidth * zoom) / variant.den) * variant.den,
  );
  const cropHeight = Math.round((cropWidth * variant.den) / variant.num);

  const left = clamp(focus[0] * w - cropWidth / 2, 0, w - cropWidth);
  const top = clamp(focus[1] * h - cropHeight / 2, 0, h - cropHeight);

  return {
    left: Math.round(left),
    top: Math.round(top),
    width: cropWidth,
    height: cropHeight,
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/* ===========================================================================
   ImageMagick
   =========================================================================== */

async function magick(argv) {
  try {
    return await run('magick', argv, { maxBuffer: 1024 * 1024 * 64 });
  } catch (error) {
    die(`magick ${argv.join(' ')}\n${error.stderr || error.message}`);
  }
}

/** Intrinsic dimensions of a written file, read back from disk rather than assumed. */
async function dimensionsOf(file) {
  const { stdout } = await magick(['identify', '-format', '%w %h', `${file}[0]`]);
  const [w, h] = stdout.trim().split(/\s+/).map(Number);
  if (!w || !h) die(`could not read the dimensions of ${relative(ROOT, file)}`);
  return { width: w, height: h };
}

/* ===========================================================================
   Rendering
   =========================================================================== */

function outputPaths(slug, category, variant) {
  const stem = `${slug}-${variant.ratio}-${variant.width}`;
  const dir = join(DERIVATIVES, category);
  return {
    dir,
    webp: join(dir, `${stem}.webp`),
    jpeg: join(dir, `${stem}.jpg`),
  };
}

/**
 * Render one derivative. `-auto-orient` first so an EXIF-rotated master still
 * crops against the pixels you are looking at; `-strip` last so EXIF — which can
 * name the photographer, a device and a location — never reaches a public bucket.
 */
async function render(master, out, crop, width, format) {
  const common = [
    master,
    '-auto-orient',
    '-colorspace',
    'sRGB',
    '-strip',
    '-crop',
    `${crop.width}x${crop.height}+${crop.left}+${crop.top}`,
    '+repage',
    '-filter',
    'Lanczos',
    '-resize',
    `${width}x`,
  ];

  if (format === 'webp') {
    await magick([...common, '-quality', String(WEBP_QUALITY), '-define', 'webp:method=6', out]);
  } else {
    await magick([
      ...common,
      '-quality',
      String(JPEG_QUALITY),
      '-sampling-factor',
      JPEG_SAMPLING,
      '-interlace',
      'none',
      out,
    ]);
  }
}

/** Why a derivative is stale, or `null` when it is current. */
async function staleness(targets, masterMtime, signature) {
  for (const file of Object.values(targets)) {
    let info;
    try {
      info = await stat(file);
    } catch {
      return 'missing';
    }
    if (info.mtimeMs < masterMtime) return 'stale-master';
  }

  if (args.state?.signatures?.[signature.key] !== signature.value) return 'crop-changed';
  return null;
}

/* ===========================================================================
   Attribution
   =========================================================================== */

/**
 * The schema requires `attribution.sourceUrl`, `photographer` and `license` to
 * be present and non-empty, and that provenance was recorded by hand during the
 * downloads — it is not in this repository. Fabricating a photographer or a
 * source URL would be worse than admitting the gap, so every field carries an
 * obviously unfilled placeholder: `example.invalid` is reserved by RFC 2606 and
 * can never resolve, so it cannot be mistaken for a real citation.
 */
const ATTRIBUTION = {
  sourceUrl: 'https://example.invalid/attribution/TODO',
  photographer: 'TODO — photographer not recorded',
  license: 'TODO — licence not recorded',
};

/* ===========================================================================
   Main
   =========================================================================== */

async function loadConfig() {
  try {
    return JSON.parse(await readFile(CONFIG, 'utf8'));
  } catch (error) {
    die(`could not read scripts/product-image-crops.json\n${String(error)}`);
  }
}

async function loadBuild() {
  try {
    return JSON.parse(await readFile(BUILD, 'utf8'));
  } catch {
    return { products: {}, signatures: {} };
  }
}

function validate(entry, slug) {
  if (!entry.category || !/^(desk|carry|write)$/.test(entry.category)) {
    die(`${slug}: "category" must be desk, carry or write`);
  }
  if (!entry.alt?.['4x3'] || !entry.alt?.['1x1']) die(`${slug}: "alt" must describe both ratios`);
  if (!entry.frame) die(`${slug}: "frame" is required`);
}

/**
 * Read a rendered variant back off disk. The manifest carries true dimensions
 * and true byte counts, never the ones the pipeline intended: `ProductImage`
 * puts `width`/`height` on the `<img>` to reserve the box, so a wrong number
 * here is a layout shift, and `bytes` is what the weight audit reads.
 */
async function measure(slug, variant, targets) {
  const webp = await dimensionsOf(targets.webp);
  const jpeg = await dimensionsOf(targets.jpeg);

  for (const [label, dims] of [
    ['webp', webp],
    ['jpeg', jpeg],
  ]) {
    const expected = variant.width * (variant.den / variant.num);
    if (dims.width !== variant.width || Math.abs(dims.height - expected) > 0.5) {
      die(
        `${slug} ${variant.ratio} ${label}: rendered ${dims.width}x${dims.height}, ` +
          `expected ${variant.width}x${expected}. The crop is off ratio.`,
      );
    }
  }

  return {
    ratio: variant.ratio,
    role: variant.role,
    width: webp.width,
    height: webp.height,
    webp: toPosix(relative(ROOT, targets.webp)),
    jpeg: toPosix(relative(ROOT, targets.jpeg)),
    bytes: (await stat(targets.webp)).size,
  };
}

function toPosix(path) {
  return path.split('\\').join('/');
}

async function main() {
  try {
    await run('magick', ['-version']);
  } catch {
    die('ImageMagick 7 (`magick`) is required. See docs/IMAGES.md.');
  }

  const config = await loadConfig();
  args.state = await loadBuild();

  const built = {};
  const skipped = [];
  let rendered = 0;

  for (const [slug, entry] of Object.entries(config.products)) {
    if (args.slug && slug !== args.slug) continue;

    if (entry.ship !== true) {
      skipped.push({ slug, reason: entry.reason ?? 'ship is not true and no reason was given' });
      continue;
    }

    validate(entry, slug);

    const master = join(MASTERS, entry.frame);
    let masterInfo;
    try {
      masterInfo = await stat(master);
    } catch {
      die(`${slug}: no master at ${relative(ROOT, master)}`);
    }

    const source = await dimensionsOf(master);
    const images = [];

    for (const variant of VARIANTS) {
      const focus = entry.focus?.[variant.ratio];
      const zoom = entry.zoom?.[variant.ratio];
      if (!Array.isArray(focus) || focus.length !== 2) {
        die(`${slug}: "focus.${variant.ratio}" must be [x, y] in 0..1`);
      }
      if (typeof zoom !== 'number' || zoom <= 0 || zoom > 1) {
        die(`${slug}: "zoom.${variant.ratio}" must be greater than 0 and at most 1`);
      }

      const crop = computeCrop(source.width, source.height, variant, focus, zoom);
      if (crop.width < variant.width) {
        die(
          `${slug} ${variant.ratio}: the crop is only ${crop.width}px wide, too narrow for a ` +
            `${variant.width}w export. Raise "zoom.${variant.ratio}" or use a larger master.`,
        );
      }

      const targets = outputPaths(slug, entry.category, variant);
      const signature = {
        key: `${slug}:${variant.ratio}`,
        value: JSON.stringify({
          frame: entry.frame,
          source,
          crop,
          width: variant.width,
          webp: WEBP_QUALITY,
          jpeg: JPEG_QUALITY,
          sampling: JPEG_SAMPLING,
        }),
      };

      const why = args.force ? 'forced' : await staleness(targets, masterInfo.mtimeMs, signature);

      if (!args.check && why !== null) {
        await mkdir(targets.dir, { recursive: true });
        await render(master, targets.webp, crop, variant.width, 'webp');
        await render(master, targets.jpeg, crop, variant.width, 'jpeg');
        rendered += 1;
      }

      const image = await measure(slug, variant, targets);
      images.push(image);
      args.state.signatures[signature.key] = signature.value;

      process.stdout.write(
        `${slug} ${variant.ratio} ${crop.width}x${crop.height}+${crop.left}+${crop.top} ` +
          `-> ${image.width}x${image.height}  ${(image.bytes / 1024).toFixed(1)}kB webp\n`,
      );
    }

    built[slug] = { slug, alt: entry.alt['4x3'], attribution: { ...ATTRIBUTION }, images };
  }

  // `--slug` merges, so a single re-crop cannot drop the other products.
  if (args.slug) {
    for (const [slug, product] of Object.entries(args.state.products ?? {})) {
      if (!(slug in built)) built[slug] = product;
    }
  }

  const products = Object.fromEntries(Object.entries(built).sort(([a], [b]) => (a < b ? -1 : 1)));

  if (args.check) {
    process.stdout.write(
      `check only: nothing written. ${Object.keys(products).length} products.\n`,
    );
  } else {
    args.state.products = products;
    args.state.generatedAt = new Date().toISOString();
    await mkdir(dirname(BUILD), { recursive: true });
    await writeFile(BUILD, `${JSON.stringify(args.state, null, 2)}\n`);
  }

  reportSkipped(skipped);
  process.stdout.write(
    `\n${rendered} derivatives rendered, ${Object.keys(products).length} products, ` +
      `${skipped.length} not shipped\n` +
      `next: node scripts/upload-images.ts  (writes product-images/manifest.json)\n`,
  );
}

function reportSkipped(skipped) {
  if (skipped.length === 0) return;
  process.stdout.write('\nnot shipped:\n');
  for (const { slug, reason } of skipped) process.stdout.write(`  ${slug}\n    ${reason}\n`);
}

await main();
