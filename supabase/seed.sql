-- Kanso — catalogue seed.
--
-- The ten V1 products from PLAN.md §2.4: four Desk, three Carry, three Write.
-- Slugs, names, spec lines, prices in kobo and inventory are taken from the
-- plan verbatim; only `description` is written here, as a plain restatement of
-- the spec line rather than a claim the plan does not make.
--
-- `image_path` is derived from the media pipeline's naming convention rather
-- than listed per row, so a fresh `npm run db:reset` produces products that
-- reference stored photographs. The storefront still renders from
-- `product-images/manifest.json`, which carries the absolute URLs — see
-- docs/DATA-MODEL.md and docs/CONTRACT-REQUESTS.md.
--
-- Idempotent: re-running converges on the plan's catalogue, including
-- inventory, so `npm run db:reset` always leaves the same ten products whether
-- the database was empty or not. `created_at` is derived from the plan's own
-- ordering so the storefront's default sort (created_at, then name) groups the
-- catalogue by division instead of alphabetically.

with catalogue (
  ordinal,
  slug,
  name,
  category,
  spec_line,
  description,
  price_kobo,
  inventory
) as (
  values
    (
      1,
      'graphite-desk-pad',
      'Graphite Desk Pad',
      'desk',
      'Dense wool felt / 900×400mm',
      'Dense wool felt, 900×400mm. A flat writing surface for the desk.',
      1850000,
      24
    ),
    (
      2,
      'milled-desk-weight',
      'Milled Desk Weight',
      'desk',
      'Single-pour cast iron / 480g',
      'Single-pour cast iron, 480g. The weight that keeps a desk still.',
      1200000,
      18
    ),
    (
      3,
      'oak-pen-cup',
      'Oak Pen Cup',
      'desk',
      'Solid white oak / 110mm',
      'Solid white oak, 110mm tall. A turned cylinder for pens and pencils.',
      950000,
      30
    ),
    (
      4,
      'steel-rule',
      'Steel Rule',
      'desk',
      'Hardened 301 stainless / 300mm',
      'Hardened 301 stainless, 300mm.',
      750000,
      12
    ),
    (
      5,
      'waxed-canvas-folio',
      'Waxed Canvas Folio',
      'carry',
      '18oz dry-waxed canvas / 13"',
      '18oz dry-waxed canvas, sized for a 13" laptop.',
      3400000,
      9
    ),
    (
      6,
      'canvas-messenger-bag',
      'Canvas Messenger Bag',
      'carry',
      'Waxed cotton canvas / 15"',
      'Waxed cotton canvas, sized for a 15" laptop.',
      5200000,
      6
    ),
    (
      7,
      'travel-tech-pouch',
      'Travel Tech Pouch',
      'carry',
      'Waxed canvas / YKK zip',
      'Waxed canvas with a YKK zip.',
      1650000,
      21
    ),
    (
      8,
      'dot-grid-notebook',
      'Dot Grid Notebook',
      'write',
      '100gsm / A5 / 160pp',
      '100gsm, A5, 160 pages, dot grid.',
      800000,
      40
    ),
    (
      9,
      'titanium-pencil',
      'Titanium Mechanical Pencil',
      'write',
      'Knurled Ti-6Al-4V / 0.5mm',
      'Knurled Ti-6Al-4V, 0.5mm lead.',
      1100000,
      15
    ),
    (
      10,
      'technical-fountain-pen',
      'Technical Fountain Pen',
      'write',
      '316L steel / fine nib',
      '316L steel body, fine nib.',
      2400000,
      4
    )
)
insert into public.products (
  slug,
  name,
  category,
  spec_line,
  description,
  price_kobo,
  inventory,
  image_path,
  created_at
)
select
  slug,
  name,
  category::public.product_category,
  spec_line,
  description,
  price_kobo,
  inventory,
  -- Derived, not hardcoded per row: the media pipeline writes every product's
  -- main derivative to `product-images/<category>/<slug>-4x3-640.webp`, and
  -- `scripts/upload-images.ts` prints the same path back. Deriving it here keeps
  -- this seed in step with that convention instead of restating ten literals
  -- that would silently rot the next time a category directory is renamed.
  'product-images/' || lower(category::text) || '/' || slug || '-4x3-640.webp',
  now() - (11 - ordinal) * interval '1 minute'
from catalogue
order by ordinal
on conflict (slug) do update
  set
    name = excluded.name,
    category = excluded.category,
    spec_line = excluded.spec_line,
    description = excluded.description,
    price_kobo = excluded.price_kobo,
    inventory = excluded.inventory,
    updated_at = now();

-- The low-stock pair is deliberate and load-bearing: `technical-fountain-pen`
-- at 4 and `canvas-messenger-bag` at 6 exist so the storefront's low-stock UI
-- has something real to render, and so the inventory test has a product that
-- can be oversold if the decrement is ever made non-conditional. Nothing in
-- this catalogue is at 0. Do not "fix" these numbers.
