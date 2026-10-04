/**
 * Product image pipeline — stage two of two.
 *
 *     node scripts/upload-images.ts [--dry-run]
 *
 * Uploads the derivatives `scripts/process-product-images.mjs` rendered into the
 * **existing** public `product-images` bucket, then writes
 * `product-images/manifest.json` using the public URL the bucket returns for
 * each object.
 *
 * ## Why the manifest holds Storage URLs
 *
 * A repo-relative path in the manifest fails twice in production:
 *
 * 1. **Vite does not rewrite strings inside imported JSON**, and a deploy
 *    publishes only `dist/`. The committed derivative is not in the bundle, so
 *    the URL 404s.
 * 2. **A relative path resolves against the current route.** On
 *    `/product/:slug` the browser asks for `/product/product-images/…`.
 *
 * The frozen schema allows it: `webp` and `jpeg` are validated only as
 * non-empty strings, so this is data conforming to the contract, not a contract
 * change. It is also what `AGENTS.md` means by "product images load from
 * Storage".
 *
 * **The URLs are environment-specific.** Running this against the local stack
 * writes `http://127.0.0.1:54321/...`. Running it against the production
 * project is what writes the production URLs — so it is part of the deploy, not
 * a one-off. The committed local manifest is a working development default, not
 * a claim about production.
 *
 * The committed derivatives stay on disk under `apps/web/public/product-images/`
 * and stay auditable; `docs/IMAGES.md` records where. They are the source, the
 * Storage objects are the served copy.
 *
 * ## The bucket is not created here
 *
 * `supabase/migrations/20261002090300_product_image_bucket.sql` creates it, so
 * `db:reset` on a clean machine produces a working bucket without anybody
 * typing a raw command. This script asserts the bucket is there and refuses to
 * carry on if it is not.
 *
 * ## Where the key comes from
 *
 * `apps/web/public/product-images/desk/steel-rule-4x3-640.webp` reduces to
 * `desk/steel-rule-4x3-640.webp`. The bucket is already called
 * `product-images`, so the prefix is dropped rather than repeated — otherwise
 * every URL would read `.../product-images/product-images/...`. That key with the
 * bucket name on the front is exactly what `products.image_path` records.
 *
 * Every segment is normalised anyway: lower-cased, anything outside
 * `[a-z0-9._-]` folded to `-`, runs collapsed, leading and trailing `.`/`-`
 * stripped, and `.`/`..` rejected outright. A filename with a space or a quote
 * in it must not be able to produce an awkward key.
 *
 * ## Credentials
 *
 * `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (or `SERVICE_ROLE_KEY`) from
 * the environment, or `supabase status -o env` parsed here — see
 * `docs/CONTRACT-REQUESTS.md` § 5, `eval "$(supabase status -o env)"` does not
 * export. Neither value is ever printed or written to disk.
 *
 * ## Idempotent
 *
 * Uploads use `upsert`, so a re-run overwrites the same keys rather than
 * creating `-1`, `-2` copies. The run then lists every folder the keys touch
 * and fails if the bucket does not hold exactly the files the build record
 * names — which is what proves the second run added nothing.
 */

import { execFile } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';

const execFileAsync = promisify(execFile);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = resolve(ROOT, '.cache', 'product-images-build.json');
const MANIFEST = resolve(ROOT, 'product-images', 'manifest.json');

/** Created by 20261002090300_product_image_bucket.sql. Never created here. */
const BUCKET = 'product-images';

/** The directory Vite serves from, and the prefix the bucket name repeats. */
const REPO_ROOT = 'product-images';

const dryRun = process.argv.includes('--dry-run');

interface BuildVariant {
  ratio: string;
  role: string;
  width: number;
  height: number;
  /** Repo-relative, as committed. Replaced by the Storage URL in the manifest. */
  webp: string;
  jpeg: string;
  bytes: number;
}

interface BuildProduct {
  slug: string;
  alt: string;
  attribution: { sourceUrl: string; photographer: string; license: string };
  images: BuildVariant[];
}

interface BuildRecord {
  generatedAt?: string;
  products: Record<string, BuildProduct>;
}

interface StoredObject {
  /** Bucket-relative key: `desk/steel-rule-4x3-640.webp`. */
  key: string;
  /** Where the file is in the repository, which is not the same place. */
  localPath: string;
  contentType: string;
  localBytes: number;
}

/* ===========================================================================
   Credentials
   =========================================================================== */

function fail(message: string): never {
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
}

/**
 * Parse the `KEY=value` block the Supabase CLI emits. Three details: there is
 * no `export` prefix, every value is wrapped in double quotes, and a JWT
 * contains `=` itself — so only the first `=` splits, and the quotes come off
 * after the split rather than before it.
 */
function parseEnvBlock(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const at = line.indexOf('=');
    if (at <= 0) continue;
    const value = line.slice(at + 1).trim();
    out[line.slice(0, at).trim()] =
      value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
  }
  return out;
}

async function fromSupabaseStatus(): Promise<Record<string, string>> {
  try {
    const { stdout } = await execFileAsync('supabase', ['status', '-o', 'env'], {
      maxBuffer: 1024 * 1024,
    });
    return parseEnvBlock(stdout);
  } catch (error) {
    fail(
      'could not run `supabase status -o env`. Start the stack with `npm run db:start`, ' +
        'or export SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY yourself.\n' +
        String(error instanceof Error ? error.message : error),
    );
  }
}

interface Connection {
  url: string;
  key: string;
  source: string;
}

async function resolveConnection(): Promise<Connection> {
  const cli = process.env.SUPABASE_URL || process.env.API_URL ? null : await fromSupabaseStatus();

  const url = process.env.SUPABASE_URL ?? process.env.API_URL ?? cli?.API_URL ?? cli?.REST_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SERVICE_ROLE_KEY ??
    cli?.SERVICE_ROLE_KEY ??
    cli?.SECRET_KEY;

  if (!url || !key) {
    fail(
      'no Supabase credentials. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, ' +
        'or run with the local stack up so `supabase status -o env` can supply them.',
    );
  }

  return {
    url,
    key,
    source:
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY
        ? 'the environment'
        : 'supabase status -o env',
  };
}

/* ===========================================================================
   Keys
   =========================================================================== */

/**
 * `apps/web/public/product-images/desk/Steel Rule-4x3-640.webp` ->
 * `desk/steel-rule-4x3-640.webp`.
 *
 * The `apps/web/public/` prefix is stripped because that is the directory Vite
 * serves from, and the `product-images/` prefix because the bucket already
 * carries it.
 */
function objectKey(repoPath: string): string {
  const relative = repoPath
    .replace(/^\/+/, '')
    .replace(/^apps\/web\/public\//, '')
    .replace(new RegExp(`^${REPO_ROOT}/`), '');

  const segments = relative.split('/').map((segment) =>
    segment
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^[.-]+/, '')
      .replace(/[.-]+$/, ''),
  );

  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    fail(`"${repoPath}" does not reduce to a usable object key.`);
  }

  return segments.join('/');
}

/* ===========================================================================
   Build record
   =========================================================================== */

async function readBuild(): Promise<BuildRecord> {
  let build: BuildRecord;
  try {
    build = JSON.parse(await readFile(BUILD, 'utf8')) as BuildRecord;
  } catch {
    fail(
      'no .cache/product-images-build.json. Run `node scripts/process-product-images.mjs` first — ' +
        'this stage uploads what that one rendered.',
    );
  }

  if (typeof build.products !== 'object' || build.products === null) {
    fail('.cache/product-images-build.json is not a build record.');
  }
  return build;
}

async function collectObjects(build: BuildRecord): Promise<StoredObject[]> {
  const objects: StoredObject[] = [];

  for (const product of Object.values(build.products)) {
    for (const image of product.images) {
      for (const [field, contentType] of [
        ['webp', 'image/webp'],
        ['jpeg', 'image/jpeg'],
      ] as const) {
        objects.push({
          key: objectKey(image[field]),
          localPath: image[field],
          contentType,
          localBytes: (await stat(resolve(ROOT, image[field]))).size,
        });
      }
    }
  }

  if (objects.length === 0) fail('the build record names no files, so there is nothing to upload.');

  const duplicates = objects.map((o) => o.key).filter((k, i, all) => all.indexOf(k) !== i);
  if (duplicates.length > 0) fail(`duplicate object keys: ${duplicates.join(', ')}`);

  return objects;
}

/* ===========================================================================
   Upload
   =========================================================================== */

async function uploadOne(client: SupabaseClient, object: StoredObject): Promise<void> {
  const { key } = object;
  const body = await readFile(resolve(ROOT, object.localPath));

  const { error } = await client.storage.from(BUCKET).upload(key, body, {
    contentType: object.contentType,
    cacheControl: '31536000',
    upsert: true,
  });

  if (error) fail(`upload of ${key} failed: ${error.message}`);
}

/** Fetch the URL back and compare it with the file on disk. An assumed URL is not a URL. */
async function verify(url: string, object: StoredObject): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) fail(`${object.key}: ${url} returned HTTP ${response.status}.`);

  const served = response.headers.get('content-type');
  if (served && !served.startsWith(object.contentType)) {
    fail(`${object.key}: served as "${served}", expected "${object.contentType}".`);
  }

  const body = Buffer.from(await response.arrayBuffer());
  if (body.byteLength !== object.localBytes) {
    fail(`${object.key}: served ${body.byteLength} bytes, the local file is ${object.localBytes}.`);
  }
}

/**
 * Count what the bucket actually holds. `list` is one directory level at a
 * time and returns folders with a null `id`, so each folder the keys touch is
 * listed separately and only real objects are counted.
 */
async function countStored(client: SupabaseClient, objects: StoredObject[]): Promise<number> {
  const folders = [...new Set(objects.map((o) => o.key.split('/').slice(0, -1).join('/')))];
  let stored = 0;

  for (const folder of folders) {
    const { data, error } = await client.storage.from(BUCKET).list(folder, { limit: 1000 });
    if (error) fail(`could not list "${folder || '/'}" in the bucket: ${error.message}`);
    stored += (data ?? []).filter((entry) => entry.id !== null).length;
  }

  return stored;
}

/** The public URL of an object, from the client's own view of the bucket. */
function publicUrl(client: SupabaseClient, key: string): string {
  return client.storage.from(BUCKET).getPublicUrl(key).data.publicUrl;
}

/* ===========================================================================
   Manifest
   =========================================================================== */

/**
 * Build the frozen-schema manifest.
 *
 * `webp` and `jpeg` become the Storage URLs; `width`, `height` and `bytes` come
 * from the files on disk, not from what the pipeline intended. `ProductImage`
 * puts `width`/`height` on the `<img>` to reserve the box, so a wrong number
 * here is a layout shift. `bytes` is the WebP — the asset `src`/`srcSet` point
 * at, and the one a browser downloads.
 */
function buildManifest(
  build: BuildRecord,
  urls: Map<string, string>,
): { version: 1; products: Record<string, unknown> } {
  const products: Record<string, unknown> = {};

  for (const [slug, product] of Object.entries(build.products)) {
    products[slug] = {
      slug: product.slug,
      alt: product.alt,
      attribution: product.attribution,
      images: product.images.map((image) => ({
        ratio: image.ratio,
        role: image.role,
        width: image.width,
        height: image.height,
        webp: urls.get(image.webp),
        jpeg: urls.get(image.jpeg),
        bytes: image.bytes,
      })),
    };
  }

  return { version: 1, products };
}

/** The `products.image_path` migration, printed from what was actually uploaded. */
function imagePathSql(build: BuildRecord): string {
  const rows = Object.values(build.products).map((product) => {
    const main = product.images.find((image) => image.ratio === '4x3') ?? product.images[0];
    return `    ('${product.slug}', '${REPO_ROOT}/${objectKey(main.webp)}')`;
  });

  return [
    'update public.products',
    'set image_path = v.image_path',
    'from (values',
    rows.join(',\n'),
    ') as v(slug, image_path)',
    'where products.slug = v.slug;',
  ].join('\n');
}

/* ===========================================================================
   Main
   =========================================================================== */

async function main(): Promise<void> {
  const { url, key, source } = await resolveConnection();
  const build = await readBuild();
  const objects = await collectObjects(build);

  process.stdout.write(
    `target   ${new URL(url).origin}\n` +
      `bucket   ${BUCKET}\n` +
      `auth     service role, from ${source} (not printed)\n` +
      `files    ${objects.length} from ${Object.keys(build.products).length} products\n\n`,
  );

  if (dryRun) {
    for (const object of objects) process.stdout.write(`  would upload  ${object.key}\n`);
    return;
  }

  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: bucket, error: bucketError } = await client.storage.getBucket(BUCKET);
  if (bucketError) fail(`could not read the "${BUCKET}" bucket: ${bucketError.message}`);
  if (!bucket?.public) {
    fail(`the "${BUCKET}" bucket is not public. Its public flag is the upload's precondition.`);
  }

  for (const object of objects) {
    await uploadOne(client, object);
    process.stdout.write(`  uploaded  ${object.key}\n`);
  }

  for (const object of objects) await verify(publicUrl(client, object.key), object);

  const stored = await countStored(client, objects);
  if (stored !== objects.length) {
    fail(
      `the bucket holds ${stored} objects but the build record names ${objects.length}. ` +
        'A previous run left something behind.',
    );
  }

  const urls = new Map<string, string>();
  for (const product of Object.values(build.products)) {
    for (const image of product.images) {
      urls.set(image.webp, publicUrl(client, objectKey(image.webp)));
      urls.set(image.jpeg, publicUrl(client, objectKey(image.jpeg)));
    }
  }

  const manifest = buildManifest(build, urls);
  await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);

  process.stdout.write(
    `\nverified ${objects.length} objects, ${stored} in the bucket\n` +
      `wrote ${Object.keys(manifest.products).length} products to product-images/manifest.json\n\n` +
      `products.image_path, for the migration:\n\n${imagePathSql(build)}\n`,
  );
}

await main();
