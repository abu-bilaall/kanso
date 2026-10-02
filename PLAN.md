# Kanso V1 — Parallel Implementation Plan

Status: ready to execute. Two prerequisites: your provisioning (Phase 0) and a single
foundation pass (Phase 1) before any parallel work starts.

---

## 1. Locked decisions

| Decision | Choice |
| --- | --- |
| Frontend | Vite + React 19 + TypeScript + Tailwind + React Router |
| Quality | Biome (format + lint), Vitest unit, Vitest functional against real Supabase |
| Backend | Supabase Postgres + Auth (Google OAuth) + Storage + Edge Functions |
| Email | Mailgun, called only from the `create-order` Edge Function |
| Deploy | Netlify (SPA), env vars from Netlify UI |
| Currency | NGN, integer kobo in DB, `₦` display |
| Catalogue | 10 products, 4 Desk / 3 Carry / 3 Write (matches Stitch filter counts) |
| Images | All existing images **discarded**. You download 10 fresh masters |
| DB access | SQL migrations only, no ORM |
| Test database | Local Supabase via `supabase start` — CI holds no secrets |
| Agents | Contract-first parallelism: interfaces frozen up front so agents never block |

Catalogue and pricing are specified in §3 so the data agent can seed without waiting.

---

## 2. Phase 0 — Your provisioning checklist

Everything here is on you. Agents cannot proceed past Phase 1 without it.
Do §2.1–2.3 first; §2.4 (images) can run in parallel with agent work in Phase 2.

### 2.1 Accounts and services

1. **Supabase** — create project `kanso`.
   - Note the region closest to Lagos (eu-west-1 recommended).
   - Keep the project password safe; you need it for the DB connection string.
2. **Google OAuth** — https://console.cloud.google.com
   - Create OAuth client, type **Web application**.
   - Authorized JavaScript origin: `http://localhost:5173` (dev) and your final Netlify
     origin, e.g. `https://kanso.netlify.app`.
   - Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`.
   - Put client ID and secret in Supabase → Authentication → Providers → Google.
     Google is **disabled by default**; enable it and paste both.
3. **Mailgun** — sign up, verify a sending domain (or use their sandbox domain for dev).
   - Copy the API key and the sending domain (`mg.yourdomain.com`).
4. **Netlify** — create a team and add the GitHub repo when it exists.
   - Do not configure the build yet; the deploy agent handles it.

### 2.2 Environment variables you must create

Frontend (safe to expose to the browser — publishable key only):

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<sb_publishable_...>
```

Edge Function secrets (Supabase dashboard → Edge Functions → Secrets, **or**
`supabase secrets set` — never in git):

```
SUPABASE_URL            # injected automatically by the runtime — do not set it
SUPABASE_SERVICE_ROLE_KEY
MAILGUN_API_KEY         # key-..., from Mailgun → Sending → domain settings
MAILGUN_DOMAIN          # bare hostname, no scheme, no trailing slash
MAILGUN_FROM            # "Kanso <orders@yourdomain.com>"
APP_URL                 # http://localhost:5173 in dev
```

Your local `.env.local` needs **only** the two `VITE_` keys above. Nothing else —
functional tests run against the local Supabase instance from §2.3, which needs
no provisioned credential.

`.env.example`, committed to the repo, documents the same two keys with empty
values, plus a comment listing the Edge Function secrets that belong in Supabase
rather than in a file.

### 2.3 Local tooling and the local database

```bash
npm install -g supabase netlify-cli   # done
supabase login                        # done
sudo systemctl start docker           # Docker daemon was inactive — must be up
supabase start                        # boots local Postgres, Auth, Storage
```

**Docker is the hard prerequisite for tests.** `docker info` must succeed before
Phase 1 begins. `sudo systemctl start docker` was verified necessary on this
machine.

**Functional tests run against the local Supabase instance, not the remote
project.** The local instance prints a static, well-known service role key, so
there is no test credential to provision or protect. Tests read connection values
from `supabase status -o env` at runtime.

Two consequences worth knowing:

- **Functional tests never use Google OAuth.** They create test users through the
  admin API with the local service key. OAuth is verified manually in Phase 3
  against the remote project.
- **Your remote project never sees test users or junk orders**, which was a real
  risk with a remote-project test setup.

Because the local stack includes the Edge Functions runtime, A2 can also serve
`create-order` locally and exercise the email-failure paths for real. Mailgun
keys for that live in a gitignored `supabase/.env.local`.

**npm note (verified 2026-10-02):** your npm blocks install scripts by default and
warned about `sharp`, `esbuild`, `unix-dgram`, and `netlify-cli`. Both `sharp` and
`esbuild` were checked and work — their native bindings ship as prebuilt
optionalDependencies (`@img/sharp-linux-x64`, `@esbuild/linux-x64`), not via
postinstall. Do **not** run `npm config set allow-scripts`; leave the security
default in place. Only `unix-dgram` is genuinely unbuilt, which only affects an
unrelated netlify-cli internal. If a `netlify deploy` ever misbehaves, reinstall
just that one package with `--allow-scripts=unix-dgram`.

### 2.4 Image downloads — your list

Ten products, one master photo each. Full art direction and search terms below.

**Save masters as** `product-images/_masters/<slug>.jpg` (create the folder).
Minimum 2000px on the long edge. Keep the original file untouched; a pipeline
agent will crop, resize and export the web derivatives.

### Art direction (applies to all ten)

The reference is the Stitch desktop screens: brutalist, technical, restrained.
Concretely, every image should be:

- **One object only.** No hands, no people, no laptops, no cups, no plants, no
  cables, no stationery scattered around.
- **Ground:** light warm paper grey, raw concrete, or seamless off-white.
  Avoid dark fabric and busy wood grain.
- **Light:** single hard-ish directional source from one side, crisp shadow.
  No flat-on-the-floor daylight, no blown-out white.
- **Framing:** object fills roughly 60–70% of the frame, centred with generous
  but not empty negative space. The current desk-weight shot fails here — the
  object is ~10% of the frame.
- **No visible third-party logos or engraved brand names.** A photo of a
  branded pen will be rejected.
- **Colour:** mostly neutral. The chartreuse accent comes from the UI, not props.

**Sources:** Unsplash or Pexels only. Free licence, no approval needed. If you use
anything else, note the licence and source URL — the media agent records
attribution per image in the manifest.

Record for each download: the page URL and the photographer name.

### The ten products

| # | Slug | Product | Spec line (for the site) | Price (kobo) | Inventory |
| --- | --- | --- | --- | --- | --- |
| 1 | `graphite-desk-pad` | Graphite Desk Pad | Dense wool felt / 900×400mm | 1850000 | 24 |
| 2 | `milled-desk-weight` | Milled Desk Weight | Single-pour cast iron / 480g | 1200000 | 18 |
| 3 | `oak-pen-cup` | Oak Pen Cup | Solid white oak / 110mm | 950000 | 30 |
| 4 | `steel-rule` | Steel Rule | Hardened 301 stainless / 300mm | 750000 | 12 |
| 5 | `waxed-canvas-folio` | Waxed Canvas Folio | 18oz dry-waxed canvas / 13" | 3400000 | 9 |
| 6 | `canvas-messenger-bag` | Canvas Messenger Bag | Waxed cotton canvas / 15" | 5200000 | 6 |
| 7 | `travel-tech-pouch` | Travel Tech Pouch | Waxed canvas / YKK zip | 1650000 | 21 |
| 8 | `dot-grid-notebook` | Dot Grid Notebook | 100gsm / A5 / 160pp | 800000 | 40 |
| 9 | `titanium-pencil` | Titanium Mechanical Pencil | Knurled Ti-6Al-4V / 0.5mm | 1100000 | 15 |
| 10 | `technical-fountain-pen` | Technical Fountain Pen | 316L steel / fine nib | 2400000 | 4 |

Inventory is deliberately varied. `technical-fountain-pen` at 4 and
`canvas-messenger-bag` at 6 exercise the low-stock UI; nothing should be at 0.

### Search terms per product

Try in this order and pick the best two or three candidates.

1. `graphite-desk-pad` — "wool felt mat minimal still life grey background",
   "felt mat flat lay studio", "grey felt fabric texture minimal"
2. `milled-desk-weight` — "cast iron object minimal still life",
   "metal block studio product photography grey", "industrial metal weight object"
3. `oak-pen-cup` — "wooden pen holder minimal still life white background",
   "oak cup product photography", "wood cylinder object studio"
4. `steel-rule` — "steel ruler macro product photography",
   "machinist rule stainless still life", "metal ruler grey background"
5. `waxed-canvas-folio` — "canvas laptop sleeve minimal product photo",
   "waxed canvas pouch studio", "canvas bag flat lay white background"
6. `canvas-messenger-bag` — "canvas messenger bag flat lay white background",
   "canvas satchel minimal product photography", "cotton canvas bag studio"
7. `travel-tech-pouch` — "canvas zip pouch flat lay minimal",
   "travel pouch product photo grey background", "small canvas case studio"
8. `dot-grid-notebook` — "dot grid notebook flat lay white background",
   "notebook blank paper studio product photography", "open notebook minimal"
9. `titanium-pencil` — "metal mechanical pencil macro product photography",
   "titanium pen minimal still life grey", "knurled metal pencil close up"
10. `technical-fountain-pen` — "fountain pen macro product photography neutral",
    "steel fountain pen studio still life", "fountain pen white background"

### Optional gallery depth

V1 needs one image per product. If you have time, grab **two** masters for
`graphite-desk-pad`, `canvas-messenger-bag` and `technical-fountain-pen`
(a second angle) so the product detail page has a real gallery instead of a
single frame. Name them `<slug>-b.jpg`. If you skip this, the UI shows a
one-image gallery, which is acceptable.

### One more asset

`stitch-designs/kanso_wordmark_logo/screen.png` is a 5KB raster of the wordmark.
An agent will vectorise it into an inline SVG component and add a matching
favicon. No action needed from you.

---

## 3. Phase 1 — Foundation (one agent, blocking, ~3–4h)

Nothing runs in parallel until this merges. Foundation owns every file that more
than one agent would otherwise touch.

Stack setup, then the **contracts**:

- `package.json`, `tsconfig.json`, `biome.json`, `vite.config.ts`,
  `vitest.workspace.ts`, `.env.example`, `.gitignore`, `netlify.toml`
- `supabase/config.toml` — committed so `supabase start` works identically for
  every agent, every worktree and CI. Local port fixed (54321) so parallel
  worktrees don't collide.
- Local-DB scripts, wired so no agent ever types a raw `supabase` command:
  `db:start`, `db:reset` (apply migrations + seed from scratch), `db:stop`,
  `db:status`, `db:functions` (serve `create-order` with local env).
- `src/styles/tokens.css` — the Stitch palette verbatim: paper `#faf9f5`,
  ink `#1b1c1a`, chartreuse `#d4f024`, surface ramp, 8px radius, 2px borders,
  Archivo + Archivo Black. Tailwind theme wired to these tokens.
- `src/components/ui/` — Button, Input, Select, QuantityControl, Badge,
  EmptyState, ErrorState, Skeleton, Alert. DESIGN.md's component vocabulary,
  nothing more.
- `src/components/layout/` — `DesktopRail` (160px fixed left rail),
  `MobileHeader`, `MobileTabBar`, page shell with the 768px switch.
- `src/lib/supabase.ts`, `src/lib/supabase.types.ts` (hand-written from SPEC,
  committed; the data agent regenerates with `supabase gen types`)
- `src/lib/env.ts` — Zod-validated `VITE_*` config
- `src/lib/money.ts` — kobo ↔ `₦` formatting via `Intl.NumberFormat('en-NG')`
- `src/lib/logger.ts`, `src/lib/errors.ts` — typed app errors, structured logging
- `src/schemas/` — Zod checkout + address schemas
- **Working** `useAuth`, `useCart`, `useProducts`, `useProduct`, `useOrder`,
  `useOrders` hooks backed by real Supabase queries. These are central and small;
  foundation ships them so no downstream agent is ever blocked on a missing hook.
- `src/routes.ts` — frozen route table:
  `/`, `/shop`, `/shop?category=`, `/product/:slug`, `/cart`, `/checkout`,
  `/order/:id`, `/account`, `/auth/callback`
- `docs/CONTRACTS.md` — one-paragraph description of every hook, its return
  shape and its error behaviour, so parallel agents code against a document
  rather than each other's branches.
- Unit tests for `money`, schemas, and the hooks (mocked client).

Foundation also runs the logging skill once and puts its conventions in
`docs/LOGGING.md` so every agent logs the same way.

### Mobile rules (Foundation decides, so agents don't each invent one)

Stitch's mobile output is incomplete: `storefront_mobile_1`,
`catalog_mobile_1`, `catalog_mobile_2`, `product_detail_mobile_1` and
`checkout_mobile_2` are all the same empty shell. Only
`storefront_mobile_2`, `catalog_mobile_3`, `product_detail_mobile_2`,
`shopping_cart_mobile` and `checkout_mobile_1` are real designs. Agents treat
those five as reference and derive the rest from the desktop design plus these
rules:

- Breakpoint 768px. Below it: sticky header (wordmark + cart badge) and a 5-item
  bottom tab bar — Store, Catalog, About, Cart, Account — with safe-area padding.
- Single-column content, 16px gutters, full-width hard 2px buttons, 44px minimum
  tap targets.
- **Override Stitch where it is bad UX:** the mobile catalogue's row layout
  (88px thumbnail + a full-width ADD TO CART button per row) is a regression. Use
  a proper thumbnail of at least 120px and a compact cart-icon action; the
  primary add-to-cart lives on the product detail page. Flag this if you disagree.
- Respect `prefers-reduced-motion`, keep visible focus rings, semantic HTML,
  labelled inputs, alt text from the manifest.

---

## 4. Repo and worktree protocol

One-time, before Phase 1:

```bash
cd ~/Work/hng/kanso
git init -b main
git add -A && git commit -m "chore: seed repo with design docs and specs"
git remote add origin <github-url> && git push -u origin main
```

Delete the existing image tree first (needs your OK): the current
`product-images/` and `.cache/masters/` are being discarded. Suggest moving them
to `/tmp` rather than deleting, so nothing is lost.

Per agent:

```bash
git worktree add ../kanso-<agent> -b feat/<agent-name> main
cd ../kanso-<agent> && npm install
```

Rules that keep merges boring:

1. **No force push. No pushes to `main`.** Agents push their branch once, when done.
2. **Path ownership is exclusive.** Each agent may only create or edit files
   under the paths in their row below. Touching another agent's paths is a
   review rejection.
3. **Frozen contract files** (the Phase 1 list) may only be edited by Foundation
   or by me during integration. If an agent needs a change, they add it to
   `docs/CONTRACT-REQUESTS.md` and continue with what exists.
4. **New dependency needed?** Ask. Do not edit `package.json` unilaterally —
   it is a merge magnet. If approved, it goes in via `docs/CONTRACT-REQUESTS.md`
   and I add it during integration.
5. `package-lock.json` is foundation/integration owned. Agents must not commit it.
6. Every agent ends with: `npm run typecheck`, `npm run check`, `npm run test:unit`
   all clean, and pushes their branch.

`.gitignore` must cover `.env`, `.env.*` (keep `.env.example`),
`supabase/.env.local`, `product-images/_masters/`, `.cache/`, `node_modules`,
`dist`, `.netlify`.

**One local Supabase instance, many worktrees.** Six agents in six worktrees all
need a database. They share the single instance from `supabase start` rather than
each running their own on the same default port. Rule for agents: never run
`db:reset` — it wipes every other agent's test data mid-run. Only Foundation,
integration, and A7 run resets. Ordinary agents use `db:start` if needed and
otherwise just connect. A1's and A7's tests clean up after themselves with unique
emails per run instead of truncating shared tables.

Image storage decision: committed derived derivatives only at the two sizes the
UI uses (640w WebP + 320w WebP, ~150KB per product total). Masters and unused
widths stay out of git. The 1600w variant is optional and should be skipped to
keep the repo small.

---

## 5. Phase 2 — Six parallel agents

All branch from `main` after Phase 1 merges. Expected wall clock 6–8h.

### A1 — Data layer
**Branch** `feat/data-layer` · **Owns** `supabase/migrations/**`,
`supabase/seed.sql`, `scripts/seed*`, `docs/DATA-MODEL.md`,
`tests/functional/db/**`

- Tables: `profiles`, `products`, `carts`, `cart_items`, `orders`, `order_items`.
- kobo integer columns, `tstzrange` not needed; use `created_at/updated_at`.
- Partial unique index enforcing one active cart per user; unique
  `(cart_id, product_id)` on cart items so a product cannot appear twice.
- Inventory decremented conditionally (`UPDATE ... WHERE inventory >= qty`,
  check row count) so concurrent checkouts cannot oversell.
- RLS on all user-owned tables: own rows only. `products` publicly readable,
  **no** insert/update/delete policy for `authenticated` — catalogue changes go
  through service role only. No `service_role` shortcuts in policies.
- `handle_new_user` trigger creating the profile row on Google signup.
- Seed the exact 10 products from §2.4 with slugs, names, spec lines, prices in
  kobo and inventory. Seed must be idempotent and re-runnable via `db:reset`.
- Functional tests against the **local** instance, reading connection values from
  `supabase status -o env`. Create test users via the admin API, never through
  Google OAuth, and use a unique email per run so parallel agents don't collide.
  Assert: user A cannot read user B's cart or orders; a normal user cannot insert
  or update a product; oversell is rejected; one active cart per user is
  enforced.
- Regenerate `src/lib/supabase.types.ts` and confirm the contract types did not
  change. If they must change, update `docs/CONTRACT-REQUESTS.md` instead of
  silently editing.

### A2 — Order creation and email
**Branch** `feat/create-order` · **Owns** `supabase/functions/create-order/**`,
`supabase/functions/_shared/**`, `tests/unit/order/**`

- Authenticate from the JWT, resolve the user server-side, never from the body.
- Zod-validate checkout payload.
- Recompute prices and total from Postgres; reject insufficient inventory with a
  structured error naming the product and the available count.
- Insert order + order_items with `unit_price_kobo` snapshots, close the cart,
  decrement inventory. All inside one transaction (RPC or equivalent) so a
  failure leaves no half-order.
- Attempt Mailgun **after** commit. On failure: log `confirmation_email_failed`
  with the order reference and reason, still return success with
  `emailSent: false`. The order is already durable.
- Structured logs for `order_create_started`, `order_created`,
  `order_create_failed`, `inventory_insufficient`,
  `confirmation_email_sent|failed`. No tokens, no service keys, no full address
  bodies in logs.
- Unit tests with a mocked Supabase client and a mocked Mailgun fetch,
  including the email-failure path asserting the order still exists.
- Optional integration pass via `db:functions` against the local stack, with
  Mailgun keys in the gitignored `supabase/.env.local`.

### A3 — Image pipeline and storage
**Branch** `feat/media` · **Owns** `scripts/**`, `product-images/**`,
`src/lib/images.ts`, `src/components/media/**`, `docs/IMAGES.md`

- Extend the existing `scripts/fetch-product-image.sh` concept into a
  `--source-file` mode, or add `scripts/process-product-images.sh`, that takes
  the masters you downloaded and emits the sizes the UI uses (4:3 main at 640w,
  1:1 thumb at 320w, WebP + JPEG fallback), recording width, height, ratio,
  alt text and source attribution in `product-images/manifest.json`.
- Add focal-point and zoom flags so a badly framed master can be re-cropped
  without refetching. Reuse the existing manifest schema.
- Write `scripts/upload-images.ts` to push the derivatives into the Supabase
  Storage `product-images` public bucket and print the resulting public URLs.
- `src/lib/images.ts`: typed lookup `getImageUrls(slug, ratio)` reading the
  committed manifest, returning `src`/`srcSet`/`width`/`height`/`alt`.
- `src/components/media/ProductImage.tsx`: renders `webp` + `jpeg` with
  `srcSet`, explicit dimensions to prevent layout shift, manifest alt text, and
  a neutral placeholder while loading.
- If any master is unusable, report it in the PR body rather than shipping a bad
  crop.

### A4 — Storefront surfaces
**Branch** `feat/storefront` · **Owns** `src/pages/home/**`,
`src/pages/catalog/**`, `src/pages/product/**`, `src/features/catalog/**`,
`src/components/product/**`

- Home: hero, featured product, product grid, category links, brand statement —
  following `stitch-designs/kanso_storefront/code.html` structurally.
- Catalogue: grid, category filter driven by the URL query param so the filter is
  shareable and back-button correct, in-stock indicator, sort control if the
  Stitch design has one. No pagination.
- Product detail: gallery, price in `₦`, spec line, quantity control clamped to
  available inventory, add to cart, low-stock and out-of-stock states.
- Mobile layouts per §3 rules for all three.
- Loading skeleton, empty catalogue, and product-load failure states.
- Unit tests for filter/sort logic and the quantity clamp.

### A5 — Cart, checkout, confirmation
**Branch** `feat/cart-checkout` · **Owns** `src/pages/cart/**`,
`src/pages/checkout/**`, `src/pages/order-confirmation/**`,
`src/features/cart/**`, `src/features/checkout/**`

- Cart: line items, quantity edit, remove, subtotal from server-fetched prices,
  empty state, checkout CTA. Guard the quantity control at available inventory.
- Checkout: visually quieter than the storefront — single column, no decorative
  elements, more whitespace, one primary action. Name, email, phone, address,
  city, state, country. Zod validation with inline field errors.
  Unauthenticated users hitting checkout are sent through Google sign-in and
  returned to checkout afterwards.
- Confirmation: order reference, items, total, shipping summary, and the
  confirmation-email notice. Read the "email sent" flag from the order creation
  response and word the notice honestly — if delivery failed, say the order is
  confirmed and the email may not have arrived, never imply the order failed.
- Explicit states for: invalid input, insufficient inventory (naming the
  product), order creation failure, email failure.
- Mobile layouts per §3. Checkout mobile is the priority — it is the screen
  that converts.
- Unit tests for the form schema and the insufficient-inventory error mapping.

### A6 — Account, auth UI, order history
**Branch** `feat/account-auth` · **Owns** `src/pages/account/**`,
`src/pages/auth/**`, `src/features/auth/**`, `src/components/account/**`

- Minimal Google sign-in screen matching the Kanso language: wordmark, one
  primary button, no marketing.
- OAuth callback route: handles loading, success, and failure explicitly,
  including the case where the user denies consent.
- Account page: profile details from the `profiles` table, order history list
  with reference, date, total and status, linking to order detail.
- Sign-out, and clear handling of "session expired" mid-session.
- Mobile layouts per §3.
- Unit tests for the callback state machine.

---

## 6. Merge order

Sequential, by me or a dedicated integrator, running `npm run check &&
npm run typecheck && npm run test:unit` after each merge and resolving
cross-agent drift there rather than in the agents' branches.

1. A1 (data) → 2. A3 (media) → 3. A2 (edge function) → 4. A4 (storefront) →
5. A5 (cart/checkout) → 6. A6 (account/auth)

A2 before A4–A6 because the storefront hooks call the function. A3 before A4 so
real images are present the moment the grid renders.

If a merge is messy, that is what the contract-first split is meant to prevent —
escalate rather than letting two agents edit the same file.

---

## 7. CI

GitHub Actions, **no secrets**. One workflow, written by A8:

```yaml
name: ci
on: [push, pull_request]
jobs:
  verify:
    runs-on: ubuntu-latest        # Docker is preinstalled
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-action@v1
      - run: supabase start
      - run: supabase db reset   # migrations + seed, identical to local
      - run: npm ci
      - run: npm run ci:check
      - run: npm run test:func
```

`supabase db reset` is the load-bearing line: CI applies migrations the same way
your machine does, so the two cannot drift. The runner behind
`npm run test:func` is what makes the rest agree: it uses the connection values
already in the environment when there are any, and otherwise asks the CLI for
them and refuses to run if the stack is not answering. A developer and a CI job
therefore get the same behaviour from the same command, and neither has to know
an `eval` incantation. No secret store involved; the values are local dev
credentials.

**Edge Function deploys stay manual**, on purpose, so CI never needs the Mailgun
credentials:

```bash
supabase functions deploy create-order --project-ref <ref>
```

If you later want CI to deploy, that single job becomes the only place a real
secret exists, added as a GitHub Actions secret with an environment gate.

---

## 8. Phase 3 — Verification and launch (2 agents, after all merges)

### A7 — Integration QA
**Branch** `qa/integration` · **Owns** `tests/functional/e2e/**`,
`docs/QA-CHECKLIST.md`

- Walk the full vertical slice on the deployed preview URL with a real Google
  account: browse → sign in → cart → checkout → order → email received →
  confirmation. This is the only place Google OAuth and real Mailgun delivery
  are verified — CI and the functional suite never touch either.
- Verify every item in the SPEC.md verification list, especially: prices
  recalculated server-side, price snapshot survives a catalogue price change,
  cart closes after checkout, inventory decrements, order survives email
  failure, no service-role key in the client bundle.
- Playwright viewport sweep at 375px, 768px, 1440px on every surface; screenshot
  each. Fix overflow, cramped tap targets, and horizontal scroll.
- Accessibility pass: keyboard traversal of the whole purchase flow, visible
  focus, labels, contrast against chartreuse, reduced motion.

### A8 — Deploy, CI and documentation
**Branch** `chore/deploy-docs` · **Owns** `netlify.toml`, `README.md`,
`docs/**`, `.github/workflows/**`

- Netlify: connect repo, build `npm run build`, publish `dist`, SPA redirect
  for client routing, env vars from §2.2 — publishable key only, no service role.
- The CI workflow from §7, verbatim.
- Verify the Edge Function is deployed and its secrets are set.
- README: local setup (`db:start` before `dev`), env var table split into
  browser-safe vs Edge Function secrets, how to apply migrations, how to seed,
  how to deploy, how to run each test suite.
- Update SPEC.md and DESIGN.md only where the implementation deliberately
  diverged.

---

## 9. Risks and the cut list

If time is short, cut in this order — each item is isolated:

1. Second-angle gallery images (§2.4 optional) — the UI already handles one frame.
2. Sort control on the catalogue.
3. The "spec matrix" decorative blocks from the Stitch desktop hero. They are
   the most droppable design element and cost real time.
4. Favourite/exotic motion. Restrained motion only, per DESIGN.md.

Never cut: server-side total calculation, RLS, inventory validation, the order
snapshot, or the email-attempt-without-corrupting-the-order behaviour.

Known risks worth watching:

- **Parallel agents touching shared files.** Mitigated by exclusive path
  ownership and frozen contracts. Watch for `src/components/ui/` — if two
  agents want a variant of `Button`, they route it through
  `docs/CONTRACT-REQUESTS.md`.
- **Migration drift.** Only A1 writes SQL. If A4–A6 need a query the schema does
  not support, they document the query they need rather than adding a migration.
- **Google OAuth redirect URLs.** The single most common launch blocker. Get the
  Netlify origin added to the Google console before A7 starts.
- **Mailgun sandbox domain.** Yours is
  `sandbox8a29c56df90c40d2a14b7d2ac82a6c92.mailgun.org`. It only delivers to the
  one address you registered with Mailgun. Fine for QA, but a real domain is
  required before launch, and `MAILGUN_FROM` must be updated to match it.
- **Docker not running.** Verified inactive on this machine. If it's down, every
  functional test and the whole CI job fails with connection errors that look
  like application bugs. `docker info` before each wave.
- **Local tests don't prove the remote project.** By design. CI and the
  functional suite validate migrations, constraints and RLS against local
  Postgres. Only the A7 pass on the preview URL proves Google OAuth, Mailgun
  delivery and Storage. Don't let that pass get squeezed.
- **npm blocks install scripts.** Verified harmless for `sharp` and `esbuild`
  (§2.3). If an agent "fixes" this by setting `allow-scripts` globally, that
  weakens your npm security posture — reject the change.
- **Supabase free tier pausing.** If the project is paused, every agent's
  functional tests fail confusingly. Check project status before starting Phase 2.