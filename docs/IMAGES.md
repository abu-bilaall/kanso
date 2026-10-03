# Kanso — Images

How a downloaded photograph becomes the file the storefront loads, how to
re-cut one when it is framed badly, where everything lives, and what is still
missing.

The consumer of all of this is `src/lib/images.ts` and
`src/components/media/ProductImage.tsx`. Both are **frozen** — see
[`CONTRACTS.md`](./CONTRACTS.md) § *Product images*. This document describes how
the data they read is produced. It does not describe how they behave.

---

## The two commands

```bash
node scripts/process-product-images.mjs   # masters -> derivatives, writes the build record
node scripts/upload-images.ts             # derivatives -> Storage, writes the manifest
```

They run in that order, and the second one says so if you skip the first. Stage
one owns ImageMagick; stage two owns Supabase.

`scripts/fetch-product-image.sh --slug <slug> --source-url <url>` is only for
getting a master in the first place. It downloads and stops there.

Requires ImageMagick 7 (`magick`) and, for the upload, the Supabase CLI or
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the environment.

---

## Two stages, and why

| Stage | Reads | Writes |
| --- | --- | --- |
| `process-product-images.mjs` | `product-images/_masters/` | `public/product-images/…` and `.cache/product-images-build.json` |
| `upload-images.ts` | the build record | the Storage bucket and `product-images/manifest.json` |

The manifest holds the **public URL of each derivative in Supabase Storage**,
so it can only be written after the upload, from the URLs the bucket returns.
Stage one records what exists on disk; stage two turns that into URLs.

---

## Size and format policy

Two crops, WebP plus a JPEG fallback for each. That is the whole set.

| Ratio | Role | Width | Height | Used by |
| --- | --- | --- | --- | --- |
| `4x3` | `main` | 640 | 480 | catalogue cards, product detail |
| `1x1` | `thumb` | 320 | 320 | cart lines, gallery thumbs |

- **WebP q82**, `webp:method=6`. **JPEG q85**, `-sampling-factor 4:4:4` —
  chroma subsampling smears exactly the edges these photographs are about: a
  rule's graduations, a notebook's dot grid, the knurl on a pen.
- `-strip` on every export. EXIF can carry a photographer, a device and a
  location, and none of that belongs in a public bucket.
- **The 1600w and 800w variants are cut.** They double the committed weight for
  bytes no V1 surface requests. `srcSet` in `src/lib/images.ts` reads whatever
  widths the manifest commits, so adding one back is a row in the pipeline's
  `VARIANTS` and a re-run — not a code change.

### What `bytes` means in the manifest

`bytes` is the **WebP** size — the asset `src` and `srcSet` point at, and the one
a browser actually downloads. The schema has a single `bytes` per variant while
each variant names two files, so this is a stated convention rather than a
derivable fact. The committed weight including the JPEG fallbacks is in
[Weight](#weight).

---

## Where everything lives

```
product-images/
├── manifest.json                        the lookup the app imports, committed
└── _masters/                            gitignored, never in version control
    └── <slug>.jpg, <slug>-2.jpg, <slug>-3.jpg

public/product-images/                   the committed derivatives
├── desk/<slug>-4x3-640.webp|.jpg
├── desk/<slug>-1x1-320.webp|.jpg
├── carry/…
└── write/…

.cache/product-images-build.json         gitignored, the record between stages
```

### The committed derivative paths

The manifest does **not** carry these — it carries Storage URLs. For auditing,
the repo-relative path of every derivative is:

| Product | 4:3 main | 1:1 thumb |
| --- | --- | --- |
| `dot-grid-notebook` | `public/product-images/write/dot-grid-notebook-4x3-640.webp` | `public/product-images/write/dot-grid-notebook-1x1-320.webp` |
| `milled-desk-weight` | `public/product-images/desk/milled-desk-weight-4x3-640.webp` | `public/product-images/desk/milled-desk-weight-1x1-320.webp` |
| `steel-rule` | `public/product-images/desk/steel-rule-4x3-640.webp` | `public/product-images/desk/steel-rule-1x1-320.webp` |
| `titanium-pencil` | `public/product-images/write/titanium-pencil-4x3-640.webp` | `public/product-images/write/titanium-pencil-1x1-320.webp` |
| `travel-tech-pouch` | `public/product-images/carry/travel-tech-pouch-4x3-640.webp` | `public/product-images/carry/travel-tech-pouch-1x1-320.webp` |
| `waxed-canvas-folio` | `public/product-images/carry/waxed-canvas-folio-4x3-640.webp` | `public/product-images/carry/waxed-canvas-folio-1x1-320.webp` |

Every one has a `.jpg` sibling at the same path with the extension swapped.
Sizes and true pixel dimensions for all twelve are in
`.cache/product-images-build.json` and in the manifest itself.

They live under `public/` so `npm run build` copies them into `dist/` and a
local checkout can be served without Storage at all. They are **not** what the
browser loads in the running app — the manifest's Storage URLs are.

---

## Re-cropping without refetching

Every per-slug decision lives in **`scripts/product-image-crops.json`**. Changing
a crop is editing two numbers and re-running both stages:

```jsonc
"steel-rule": {
  "ship": true,
  "category": "desk",
  "frame": "steel-rule.jpg",
  "focus": { "4x3": [0.5, 0.24], "1x1": [0.5, 0.24] },
  "zoom":  { "4x3": 0.38,  "1x1": 0.32  }
}
```

| Field | Meaning |
| --- | --- |
| `focus` | Focal point in `0..1` source coordinates, x from the left, y from the top. The crop window centres on it and is then clamped so it never runs off an edge. |
| `zoom` | Fraction of the largest window that ratio allows. `1.0` is widest; `0.38` is two and a half times as tight. |
| `frame` | Which master supplies the frame. The schema holds **one frame per ratio**, so pick the best frame rather than the first one. |
| `ship` | `false` keeps the product out of the manifest. The reason is printed on every run. |
| `alt` | One string per ratio, because the crop decides the pixels. |

```bash
node scripts/process-product-images.mjs --slug steel-rule   # merge, re-crop one
node scripts/upload-images.ts
node scripts/process-product-images.mjs --force             # re-render everything
node scripts/process-product-images.mjs --check             # verify, write nothing
```

`--slug` **merges** into the build record rather than replacing it; a full run is
authoritative and rebuilds `products` from the config, which is what retires a
slug whose `ship` flips to `false`.

**Idempotent.** A derivative is re-rendered only when it is missing, when its
master is newer, or when that slug's crop parameters changed. State lives in
`.cache/product-images-build.json`, which is gitignored.

### Why the crop cannot be naive

`oak-pen-cup` is 5127×6837 and `titanium-pencil` is 5464×8192 — both far taller
than 4:3. A centred 4:3 crop off a 2:3 portrait keeps only the middle half of
the height, which for a tall object is a picture of its middle. The `focus` and
`zoom` values above are the result of rendering candidates and **looking at
them**; there is no heuristic that replaces that step.

---

## When a master is unusable

`"ship": false` with a `reason`. The product then has no manifest entry, and
`getImageUrls` returns `null` for it — which is the designed behaviour, not a
failure. `ProductImage` renders a neutral panel of exactly the same size, so the
grid neither breaks nor shifts.

A master is unusable when **no crop fixes it**, not when the crop is merely hard.
The three cases here are all third-party trademarks legible at 640w, which
`PLAN.md` §2.4 rejects outright and which no amount of cropping removes.

A master that is merely badly framed is a `focus`/`zoom` problem: keep
`"ship": true` and re-cut it.

---

## Storage

Bucket `product-images`, public, 5 MiB ceiling — created by
`supabase/migrations/20261002090300_product_image_bucket.sql`. **The upload
script never creates it**; it reads the bucket, refuses to continue unless it is
public, and fails loudly if it is missing.

```bash
node scripts/upload-images.ts --dry-run   # keys and target, no writes
node scripts/upload-images.ts
```

- Object keys are `desk/steel-rule-4x3-640.webp`: the `public/` prefix is
  dropped because that is the directory Vite serves from, and the
  `product-images/` prefix is dropped because the bucket already carries it.
  Without that, every URL would read `.../product-images/product-images/...`.
- Keys are normalised anyway: lower-cased, anything outside `[a-z0-9._-]` folded
  to `-`, runs collapsed, edge `.`/`-` stripped, `.`/`..` rejected.
- Uploads use `upsert`, so a re-run overwrites rather than creating `-1` copies.
  The run then lists the bucket and **fails if the object count is not exactly
  the number of files the build record names** — that is what proves idempotency
  rather than asserting it.
- Public URLs come from the client's `getPublicUrl`, not from a concatenated
  path, and every one is then fetched back and byte-compared against the local
  file. A URL nobody requested is not a URL anyone has checked.
- Credentials come from the environment or from `supabase status -o env`, which
  this script parses itself (`docs/CONTRACT-REQUESTS.md` § 5: `eval "$(supabase
  status -o env)"` does not export). Neither value is printed or written to disk.

### The manifest holds Storage URLs, and they are environment-specific

```jsonc
"webp": "http://127.0.0.1:54321/storage/v1/object/public/product-images/desk/steel-rule-4x3-640.webp"
```

That is the local stack, because that is what the committed manifest was
generated against. **It is not a production claim.**

A repo-relative path fails twice in production: Vite does not rewrite strings
inside imported JSON and a deploy publishes only `dist/`, so the committed
derivative is not in the bundle at all; and a relative path resolves against the
current route, so on `/product/:slug` the browser asks for
`/product/product-images/…`. Both were observed before this was changed.

The frozen schema allows the fix — `webp` and `jpeg` are validated only as
non-empty strings — so this is data conforming to the contract, not a contract
change. See [`CONTRACT-REQUESTS.md`](./CONTRACT-REQUESTS.md).

**Running `upload-images.ts` against the production project is part of the
deploy**, not a one-off: it uploads to that project and rewrites the manifest
with that project's URLs. A manifest generated against the local stack and
deployed as-is will show the storefront its neutral panels, because
`127.0.0.1` is the shopper's own machine.

### `products.image_path`

The storefront renders from the manifest, so a null `image_path` degrades
gracefully. The column records the Storage object for the record. It is seeded
null and is populated by this statement, which `upload-images.ts` prints at the
end of every run so it cannot drift from what was actually uploaded:

```sql
update public.products
set image_path = v.image_path
from (values
    ('dot-grid-notebook', 'product-images/write/dot-grid-notebook-4x3-640.webp'),
    ('milled-desk-weight', 'product-images/desk/milled-desk-weight-4x3-640.webp'),
    ('steel-rule', 'product-images/desk/steel-rule-4x3-640.webp'),
    ('titanium-pencil', 'product-images/write/titanium-pencil-4x3-640.webp'),
    ('travel-tech-pouch', 'product-images/carry/travel-tech-pouch-4x3-640.webp'),
    ('waxed-canvas-folio', 'product-images/carry/waxed-canvas-folio-4x3-640.webp')
) as v(slug, image_path)
where products.slug = v.slug;
```

One row per product, pointing at the `4x3` main: `image_path` is a single column
and the main is the crop it should record.

**This branch does not edit `seed.sql` or any migration** — the data agent owns
both. The statement above is the reproducible form to land as a migration during
integration.

---

## Weight

Committed derivatives, six products, both ratios, WebP **and** JPEG:

| Product | Bytes | |
| --- | ---: | --- |
| `waxed-canvas-folio` | 46,013 | 45.0 KB |
| `titanium-pencil` | 57,526 | 56.2 KB |
| `milled-desk-weight` | 73,542 | 71.8 KB |
| `dot-grid-notebook` | 97,354 | 95.1 KB |
| `travel-tech-pouch` | 120,632 | 117.8 KB |
| `steel-rule` | 150,009 | 146.5 KB |
| **total** | **545,076** | **532.3 KB** |

Mean **88.8 KB per product** against a ~150 KB budget. What a browser downloads
is the WebP half: **166,398 bytes** across all twelve variants, 13.9 KB mean.

`steel-rule` is the heaviest because a macro of engraved metal has detail
everywhere; it lands at the budget rather than over it. Lowering `WEBP_QUALITY`
in the pipeline would buy headroom at the cost of exactly the numerals the
photograph exists to show.

---

## Open gaps

### Attribution is a placeholder on all six products

The schema requires `attribution.sourceUrl`, `photographer` and `license` to be
present and non-empty, and that provenance was recorded by hand during the
downloads — it is not in this repository. **Every entry currently carries an
obviously unfilled placeholder**, and every one of these slugs needs the real
values:

`dot-grid-notebook`, `milled-desk-weight`, `steel-rule`, `titanium-pencil`,
`travel-tech-pouch`, `waxed-canvas-folio`

```jsonc
"attribution": {
  "sourceUrl": "https://example.invalid/attribution/TODO",  // RFC 2606: can never resolve
  "photographer": "TODO — photographer not recorded",
  "license": "TODO — licence not recorded"
}
```

Fabricated attribution is worse than missing attribution, so nothing was guessed.
When the provenance is recovered, replace the three fields per product in
`scripts/product-image-crops.json`'s sibling — the `ATTRIBUTION` constant in
`scripts/process-product-images.mjs` is the one place they are written from — and
re-run both stages.

### Four products have no photograph

| Slug | Why |
| --- | --- |
| `canvas-messenger-bag` | no master was downloaded |
| `graphite-desk-pad` | every candidate is a dark lifestyle desk shot; cropping to the felt mat alone leaves a featureless rectangle |
| `oak-pen-cup` | the primary is a branded takeaway cup on a dark ground; the alternates are a decorated pen pot and a cup of branded highlighters |
| `technical-fountain-pen` | a nib macro with the maker's name engraved on it, legible at 640w |

All four render as the neutral panel. Adding a master is: drop it in
`_masters/`, add or flip its row in `scripts/product-image-crops.json`, run both
stages.

### Second angles are downloaded but unused

`graphite-desk-pad`, `oak-pen-cup`, `steel-rule` and `titanium-pencil` have
second and third masters in `_masters/`. The frozen schema keys `images[]` by
ratio and role, and `getImageUrls` resolves one frame per ratio, so a gallery
cannot be expressed without changing a contract four agents depend on. One frame
per ratio ships. `titanium-pencil` uses its `-2` master because the primary is
too small in frame; the rest are unused. See
[`CONTRACT-REQUESTS.md`](./CONTRACT-REQUESTS.md) § 12.