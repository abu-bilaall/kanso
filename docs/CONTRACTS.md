# Kanso — Contracts

> **Status: reference, with history.** Written in Phase 1 to freeze a surface six
> agents could build against without seeing each other. The API shapes — tokens,
> components, `PageShell`, routes, hooks, money, errors, schemas — are still the
> contract and still describe the code. Statements about the state of the world
> *during* the build have aged; the two that would actively mislead you are
> corrected in place and marked. See [`docs/README.md`](./README.md).

**Frozen contract surface. Phase 1 (Foundation) owns everything in this document.**

Six agents build the rest of Kanso in parallel, each on its own branch, none able
to see the others' work. These files are what they code against. They are
written down here precisely so nobody has to *wait* for anybody, and precisely so
a change to one of them is a visible, deliberate event rather than a surprise in
a merge.

If any of this does not fit what you are building: **do not edit it.** Write what
you need in [`CONTRACT-REQUESTS.md`](./CONTRACT-REQUESTS.md) and keep building
against what exists. Requests are reviewed and applied once, centrally, during
integration — see [How to ask for a change](#how-to-ask-for-a-change).

---

## Contents

1. [The rule about frozen files](#the-rule-about-frozen-files)
2. [Placeholder pages](#placeholder-pages--history-kept-for-the-convention) *(history)*
3. [Design tokens](#design-tokens)
4. [Component vocabulary](#component-vocabulary)
5. [Page shell and the responsive switch](#page-shell-and-the-responsive-switch)
6. [Routes](#routes)
7. [Hooks](#hooks) ← *the important one*
8. [Money](#money)
9. [Errors](#errors)
10. [Logging](#logging)
11. [Schemas](#schemas)
12. [Supabase client and types](#supabase-client-and-types)
13. [Product images](#product-images) ← *read this before rendering a photo*
14. [Commands](#commands)

---

## The rule about frozen files

Foundation owns, and only Foundation edits:

```
package.json          package-lock.json      tsconfig*.json
biome.json            vite.config.ts        vitest.config.ts
supabase/config.toml  .env.example         .gitignore
types/node-shim.d.ts                        the Node types tests and scripts need
src/routes.ts         src/styles/**        src/lib/**
src/hooks/**          src/components/**     src/schemas/**
src/pages/not-found/**                      the catch-all page
docs/CONTRACTS.md     docs/LOGGING.md       docs/CONTRACT-REQUESTS.md
product-images/manifest.json   (the media agent fills it; nobody changes its shape)
```

Everything else belongs to a downstream agent by path (PLAN §5). Touching another
agent's path is a review rejection.

**Why package.json is frozen too.** PLAN §4 rule 4: a new dependency added
unilaterally is "a merge magnet". If you need one, it goes through
`CONTRACT-REQUESTS.md`.

## How to ask for a change

Append to `docs/CONTRACT-REQUESTS.md`, with:

- **What you are building** — one line.
- **The exact change** — a diff, or the signature you need added.
- **Why the existing surface cannot do it** — the honest reason, not a preference.
- **Who else depends on it** — if the change is observable, say so.

Then carry on. Do not wait. Do not edit the frozen file in your branch "just to
unblock yourself" — that is how two agents end up with two `Button` components.

---

## Placeholder pages — history, kept for the convention

> **Historical, and now fully discharged.** Phase 1 wrote this when all nine
> routes rendered a **placeholder**: a module that says so, rather than a
> half-finished page. Every page replaced its own, and at the integration-3 pass
> the last importer went with it — the `*` route renders
> `src/pages/not-found/NotFoundPage.tsx`, a real page, and
> `src/pages/_placeholder/Placeholder.tsx` is deleted. The list below is the
> original Phase 1 state, not today's.
>
> **Why the last one had to go rather than be kept for the catch-all.** The
> catch-all route is right and stays: a blank screen on a mistyped URL is a
> silent failure. What was wrong was what it rendered. "Not built yet" and
> "Owned by nobody — it is not a real surface" told a stranger our build state
> in our build voice. Scaffolding language belongs to the people writing the
> code; a visitor gets a sentence about their URL and a way back into the shop.

```
src/pages/_placeholder/Placeholder.tsx     the shared component — deleted
src/pages/home/HomePage.tsx                <Placeholder path="/" owner="A4 — Storefront" … />
src/pages/catalog/CatalogPage.tsx
src/pages/product/ProductPage.tsx
src/pages/cart/CartPage.tsx
src/pages/checkout/CheckoutPage.tsx
src/pages/order-confirmation/OrderConfirmationPage.tsx
src/pages/account/AccountPage.tsx
src/pages/auth/AuthCallbackPage.tsx
```

**Your page replaces its module wholesale.** You own that path from Phase 2
onward. Delete the `<Placeholder>` call; do not keep it in a branch, do not import
it alongside real markup, do not feature-flag around it.

`npm run build` and `npm run dev` are green with all of them in place. That was the
point of the convention: nobody mistakes a placeholder for finished work — and
the corollary, learned the hard way, is that a visitor must never be the one who
mistakes one for the shop.

---

## Design tokens

`src/styles/tokens.css`. Two layers, and the distinction matters:

| Layer | Where | Who touches it |
| --- | --- | --- |
| `--k-*` primitives | top of the file, raw Stitch values | Foundation only |
| `@theme inline` | middle of the file, semantic → primitive | Foundation only |

Tailwind v4 is CSS-first: the `@theme` block *is* the design system. Anything
declared under `--color-*`, `--font-*`, `--radius-*`, `--spacing-*` becomes a
utility automatically.

**Rule: no component ever contains a hex value.** Everything resolves from these
tokens.

**The spacing scale is `k-` namespaced, and it has to stay that way.** The
entries are `--spacing-k-xs` … `--spacing-k-xl`, `--spacing-k-gutter`,
`--spacing-k-gutter-desktop`, `--spacing-k-rail`, so a call site writes
`gap-k-md`, `pt-k-lg`, `px-k-gutter`, `md:w-k-rail`. Tailwind resolves a named
`max-w-<name>` (and `w-<name>`, `min-w-<name>`) against `--container-<name>`
*and* `--spacing-<name>`; a theme that publishes a bare `--spacing-sm` silently
captures `max-w-sm` and renders it at 8px instead of 24rem. A class name that
means something other than what it says is the worst kind of bug, and it is
invisible to `npm run check:classes`, which only asks whether a class generates
a rule. `tests/unit/styles/containerWidths.test.ts` compiles the real stylesheet
and pins the named widths.

### Colours

| Token | Value | Use it for |
| --- | --- | --- |
| `paper` | `#faf9f5` | the page ground. `bg-paper` |
| `ink` | `#1b1c1a` | primary text, the hard edge. `text-ink`, `border-ink` |
| `graphite` | `#1b1c1d` | pressed/hover state of an ink surface |
| `ink-muted` | `#44474a` | secondary text, labels |
| `ink-subtle` | `#75777a` | tertiary text, meta copy |
| `ink-on-primary` | `#ffffff` | text on a solid ink button |
| `ink-on-accent` | `#191e00` | text on chartreuse |
| `accent` | `#d4f024` | chartreuse. One use per view |
| `accent-deep` | `#576400` | chartreuse text *on paper*, when you need it readable |
| `hairline` | `#c5c6c9` | the 1px structural rule. `border-hairline` |
| `danger` | `#ba1a1a` | destructive |
| `danger-surface` / `danger-ink` | `#ffdad6` / `#93000a` | the error panel |
| `inverse` / `inverse-text` | `#30312e` / `#f2f1ed` | the one dark panel |

### Surface ramp

`surface-lowest` `#ffffff` (raised cards — the only pure white in the system) ·
`surface-low` `#f5f4f0` · `paper` `#faf9f5` · `surface-container` `#efeeea` ·
`surface-high` `#e9e8e4` · `surface-highest` `#e3e2df` · `surface-dim` `#dbdad6`

### Typography

| Token | Face | Use |
| --- | --- | --- |
| `font-sans` | Archivo 400/500/600/700 | **everything functional** — labels, body, product names |
| `font-display` | Archivo Black | **hero and section headings only** |
| `font-editorial` | system monospace | the reserved secondary face |

`font-editorial` is the secondary face PLAN §3 asks you to reserve. Every
technical/meta string in the Stitch prototypes — `FULFILLMENT & DISPATCH / V1`,
`#KS-8902-DX`, spec rows — is set in the prototype's mono voice, so that is what
the token is. **Editorial moments only. Never body copy.**

Type scale: `text-meta` 11px · `text-body` 16px · `text-body-lg` 18px ·
`text-label` 14px/0.06em · `text-heading` 30px · `text-hero` 48px.

### Geometry and motion

| Token | Value |
| --- | --- |
| `rounded-component` | 8px — the component radius |
| `rounded-tight` | 4px — chips, badges |
| `rounded-panel` | 12px — large media panels only |
| `border-hard` | a utility: `border-hard` = 2px solid. **Always 2px on primary interactive elements** |
| `tap-target` | a utility: min 44×44. PLAN §3 minimum |
| `transition-kanso` | a utility: 180ms on colour/edge/transform |
| `--k-rail-width` | 160px |
| `--k-tabbar-height` | 56px |
| `--k-gutter` / `--k-gutter-desktop` | 16px / 24px |
| `--breakpoint-md` | **768px** — Tailwind's `md`. The switch |

`prefers-reduced-motion: reduce` is honoured globally in `tokens.css`: every
transition and animation collapses. Do not re-enable motion in a component.

---

## Component vocabulary

`src/components/ui` — DESIGN.md's list and nothing more. Import from
`@/components/ui`.

| Component | Notes |
| --- | --- |
| `Button` | `variant`: `primary` (ink, hard 2px) · `accent` (chartreuse) · `outline` · `surface` · `ghost` · `danger`. `size`: `sm`/`md`/`lg`. `loading`, `fullWidth`, `icon` |
| `buttonClasses(opts)` | the same styling as a class string, for a `<Link>` or `<a>`. **Use this instead of a polymorphic `as` prop** |
| `Input` | `label` required. `error` wires `aria-invalid` + `aria-describedby`. `hint`, `trailing`, `required`. forwardRef |
| `Select` | native `<select>`, same a11y contract. `options: {value,label,disabled?}[]`, `placeholder` |
| `QuantityControl` | clamped, not corrected. `onChange` only fires inside `[min, max]`. **Pass `max={product.inventory}`** |
| `Badge` | `children` required — DESIGN.md forbids colour-only status |
| `EmptyState` | loaded successfully, nothing here. Needs `title` + `action` |
| `ErrorState` | the request failed. Offers "Try again" only when `error.retryable` |
| `Skeleton` | `aria-hidden` by default; the owning region carries the label |
| `Alert` | inline non-blocking message. `tone`: `info`/`success`/`warning`/`danger`. `role="alert"` for danger and warning |

Icons: `src/components/icons.tsx` — twelve outline SVGs on one grid. No icon
package is a dependency; **add to that file rather than importing another family.**

Product imagery is separate, because it is a different kind of component: one
product, one component. `src/components/media/ProductImage.tsx` renders every
photo in the app — see [Product images](#product-images).

Adding a tenth-and-a-half primitive is a contract change. Two agents with two
variants of `Button` is how a shop stops looking like one shop.

## Page shell and the responsive switch

`src/components/layout`:

| Component | Visibility |
| --- | --- |
| `DesktopRail` | `hidden` below 768px. Fixed 160px left column |
| `MobileHeader` | below 768px. Sticky. Wordmark + cart, or back + context label |
| `MobileTabBar` | below 768px. Fixed, 5 items, safe-area padded |
| `PageShell` | the frame. **Owns the switch** |

Every page renders inside `PageShell`:

```tsx
export function CatalogPage() {
  return (
    <PageShell title="Catalogue — Kanso" width="wide">
      {/* your content */}
    </PageShell>
  );
}
```

| Prop | Meaning |
| --- | --- |
| `title` | sets `document.title`. Just the page name; the shell appends nothing |
| `header` | replaces the mobile header — product detail and checkout want a back control |
| `width` | `narrow` (2xl, checkout) · `default` (5xl) · `wide` (7xl, catalogue) |

Do not build your own header, footer, gutter or safe-area padding. If you think
the shell is missing something, that is a `CONTRACT-REQUESTS.md` entry.

### Mobile rules (PLAN §3, decided in Phase 1)

- Breakpoint **768px**. Below it: sticky header + 5-item tab bar.
- Tab bar items: **Store, Catalog, About, Cart, Account.**
- Single column, 16px gutters, full-width hard 2px buttons, 44px minimum targets.
- **Override Stitch where it is bad UX.** The mobile catalogue's row layout
  (88px thumbnail + a full-width ADD TO CART per row) is a regression. Use a
  thumbnail of **at least 120px** and a compact cart-icon action; the primary
  add-to-cart lives on the product detail page. Flag it if you disagree.
- Visible focus rings, semantic HTML, labelled inputs, alt text from the manifest.

## Routes

`src/routes.ts` is frozen. Import `routes`, or the `ROUTE_PATHS` helpers.

| Path | Module | Agent |
| --- | --- | --- |
| `/` | `src/pages/home/HomePage` | A4 |
| `/shop` · `/shop?category=` | `src/pages/catalog/CatalogPage` | A4 |
| `/product/:slug` | `src/pages/product/ProductPage` | A4 |
| `/cart` | `src/pages/cart/CartPage` | A5 |
| `/checkout` | `src/pages/checkout/CheckoutPage` | A5 |
| `/order/:id` | `src/pages/order-confirmation/OrderConfirmationPage` | A5 |
| `/account` | `src/pages/account/AccountPage` | A6 |
| `/auth/callback` | `src/pages/auth/AuthCallbackPage` | A6 |
| `*` | `src/pages/not-found/NotFoundPage` | Foundation |

Two decisions that will bite if you miss them:

- **Category is a query param, not a path segment.** `/shop?category=desk` keeps
  one component, makes a filtered view shareable, and makes the back button
  correct. Read it with `CATEGORY_PARAM` from `@/routes`.
- **There is no `/about` route.** The rail and the tab bar both point ABOUT at
  `/#about`. **If you build the home page, give the brand-statement section
  `id="about"`** and both nav entries work for free.

---

## Hooks

Import from `@/hooks`. All of them are backed by real Supabase queries, and all of
them share one return shape.

> **Historical.** This was written when the database had no tables and every
> hook degraded into a clean `error` state. The schema landed in Phase 2 — six
> migrations, ten seeded products — so the hooks now hit real tables. The
> degradation itself is still the contract and is still tested: a hook never
> throws, never hangs, and never returns a rejected promise. See
> [`DATA-MODEL.md`](./DATA-MODEL.md).

### The shared shape

```ts
type AsyncStatus = 'idle' | 'loading' | 'success' | 'error';

interface AsyncState {
  data: <the neutral empty value> | <T>;  // never null-shaped surprises
  status: AsyncStatus;
  error: AppError | null;                 // non-null iff status === 'error'
  isLoading: boolean;                     // true while in flight, incl. the first
  refresh: () => Promise<void>;           // re-run; keeps the last value on screen
}
```

`refresh()` retains the previous `data` while it runs, so a re-fetch never blanks
the UI. `idle` means "not started" (signed out, disabled, or no id) — never a
failure.

### `useAuth()`

The single source of truth for the session. Mount `<AuthProvider>` once — it is
already in `src/main.tsx`. Every other hook reads from it rather than touching
`supabase.auth`.

```ts
interface AuthState {
  status: 'loading' | 'authenticated' | 'anonymous' | 'error';
  user: User | null;
  session: Session | null;
  error: AppError | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  signInWithGoogle: (options?: { redirectTo?: string }) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}
```

- `status` stays `'loading'` until the first read settles. **Render a spinner,
  not "signed out", during that window** — flashing a sign-in button at a
  signed-in user is the classic OAuth bug.
- `'anonymous'` means genuinely no session. `'error'` means the read failed. The
  two are never conflated.
- `signInWithGoogle` defaults `redirectTo` to `<origin>/auth/callback`. It
  resolves once the browser has been redirected and **rejects** with an
  `AppError` if sign-in could not start — show that inline, do not crash.
- Also exported: `useUserId()` → `string | null`, for the common guard.

### `useProducts(options?)`

```ts
interface UseProductsOptions { category?: ProductCategory | 'all'; enabled?: boolean }

interface ProductsState {
  products: Product[];          // [] while loading, on error, and when empty
  status: AsyncStatus;
  error: AppError | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
}
```

One publicly-readable select, ordered `created_at` then `name`. `category` is
filtered **in the database**, not in JS. Sorting and the featured selection are
the catalogue page's business (A4) — do that over the array this returns. There
is no `is_active` column in V1.

Also exported: `CATEGORIES` (render your filter from it) and `categoryLabel()`,
which falls back to a title-cased slug rather than throwing on an unknown
division.

### `useProduct(slug, options?)`

```ts
interface ProductState {
  product: Product | null;
  status: AsyncStatus;
  error: AppError | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
}
```

`maybeSingle()` on `slug`. **A miss is `not_found`, not `null`** — render a 404
panel, and note `retryable: false`, so `ErrorState` will not offer a retry that
cannot change anything. Passing `undefined` issues no query and stays `idle`.

### `useCart()`

The signed-in user's active cart, with every mutation the UI needs.

**One store, many readers.** Cart state lives in a single external store, so the
rail badge, the mobile header badge, the tab bar and the page all read the same
value. Mount it anywhere, in any order: a concurrent first read is shared, a
mutation from one consumer is visible to all of them without a refresh, and a
superseded read cannot overwrite a newer one.

```ts
interface CartState {
  cart: Cart | null;
  items: CartItemWithProduct[];  // `product` is joined in; may be null if deleted
  itemCount: number;             // the rail badge
  subtotalKobo: number;          // integer kobo, from server prices
  status: AsyncStatus;
  error: AppError | null;
  isLoading: boolean;
  isMutating: boolean;           // disable a button during a mutation
  refresh: () => Promise<void>;
  addItem: (productId: string, quantity?: number) => Promise<void>;
  setItemQuantity: (productId: string, quantity: number) => Promise<void>;
  removeItem: (productId: string) => Promise<void>;
  clear: () => Promise<void>;
}
```

- **Anonymous visitors get an empty cart and no prompt.** They are asked to sign
  in at checkout, which is the journey DESIGN.md describes.
- **One active cart per user.** `useCart` resolves it lazily and creates one on
  first use if the user has none.
- `addItem` upserts onto `(cart_id, product_id)`, so a product never appears
  twice. `setItemQuantity(p, 0)` deletes the line.
- Mutations re-read live `inventory` and reject with `InsufficientInventoryError`
  (`code: 'insufficient_inventory'`, `productId`, `available`). That check is a
  courtesy — `create-order` enforces it again server-side, and that one counts.
- **Mutations reject.** A failure throws and leaves `status` alone, so the caller
  surfaces the message itself — `try/catch` for inline feedback on the row that
  caused it, or watch `isMutating` to disable the control. Setting `error` on a
  failed mutation is deliberately *not* done: it would flip `status` to `'error'`
  and replace the whole cart with an error state, losing the basket.
- `subtotalKobo` is a **display convenience, not an authority.** The order total
  is recalculated by `create-order`, which never trusts this value.
- While the session is still loading, `status` is `'loading'`, not `'idle'` —
  otherwise a signed-in user sees an empty cart flash on every page load.

### `useOrder(id, options?)`

```ts
interface OrderState {
  order: Order | null;
  items: OrderItemWithProduct[];  // price snapshots, with a slug/name join
  status: AsyncStatus;
  error: AppError | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
}
```

`:id` is the order **uuid**, not the human-facing reference. The query filters on
`user_id` as well as `id` — defence in depth behind RLS, and a test asserts it.
A miss is `not_found`, never `forbidden`, so the UI cannot be used to probe which
ids exist. Totals come from the snapshots; never recompute them.

### `useOrders()`

```ts
interface OrderSummary extends Order { itemCount: number }
interface OrdersState {
  orders: OrderSummary[];  // newest first; [] while loading, signed out, or empty
  status: AsyncStatus;
  error: AppError | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
}
```

Signed out: `status: 'idle'`, `orders: []`, **no error** — the account page shows
a sign-in prompt, not an error panel. One query with `order_items(count)`, so
there is no N+1.

---

## Money

`src/lib/money.ts`. **Integer kobo everywhere.** 1 naira = 100 kobo. No floats
in application code — not `price * 0.9`, not a `reduce` that can drift.

```ts
const KOBO_PER_NAIRA = 100;
const CURRENCY = 'NGN';   // ISO 4217
const LOCALE = 'en-NG';

formatMoney(kobo: number, options?: { compact?: boolean }): string
//   1850000 -> '₦18,500.00'      compact -> '₦18,500'
//   Non-finite input renders '—', never '₦NaN' on a price.

toNaira(kobo: number): number          // 1850000 -> 18500
fromNaira(naira: number): number       // 18500  -> 1850000

parseMoneyToKobo(input: string): number | null
//   Round-trips: parseMoneyToKobo(formatMoney(k)) === k.
//   The input is NAIRA, because naira is what people see and type.
//   '.' is always the decimal point; ',' groups thousands; ',NN' is a decimal.
//   Accounting parentheses mean negative. 2dp max, truncated not rounded.
//   Returns null rather than guessing.

formatMoneyDelta(kobo: number): string  // '+₦1,200.00' / '—' at zero

sumLineTotals(lines: ReadonlyArray<{ quantity: number; unitPriceKobo: number }>): number
//   Use this instead of writing your own reduce over money.
```

**Round a price for display and you have a bug.** `create-order` recomputes the
authoritative total server-side; your subtotal is a courtesy.

## Errors

`src/lib/errors.ts`. Every error crossing a service boundary is normalised to
`AppError`, so UI code decides on `error.code` and never string-matches a
message.

```ts
const APP_ERROR_CODES = [
  'configuration', 'unauthenticated', 'forbidden', 'not_found', 'validation',
  'insufficient_inventory', 'rate_limited', 'network', 'server', 'cancelled', 'unknown',
] as const;

class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status?: number;
  readonly details?: Record<string, unknown>;
  readonly retryable: boolean;   // can the user usefully try again?
  toLogFields(): { code; message; status?; details? }   // safe to log
}

class InsufficientInventoryError extends AppError {
  readonly productId?: string;
  readonly available?: number;
}

class ConfigurationError extends AppError {}
class ForbiddenCredentialError extends ConfigurationError {}

toAppError(error: unknown, context?: string): AppError
```

`context` is a short noun phrase — `'Could not load the catalogue'` beats
`TypeError: Failed to fetch`. `retryable` is what `ErrorState` reads, so a 404
does not offer "Try again".

`AppError.message` is written for a human and is safe to render. `details` is
machine-readable context — **never credentials, never a full payload.**

## Logging

Full conventions in [`LOGGING.md`](./LOGGING.md). The API:

```ts
logger.info(event: LogEvent): void
logger.error(event: LogEvent): void     // adds outcome: 'failure'
logger.setContext(fields: LogFields): void
logger.child(fields: LogFields): Logger
logger.setLevel('info' | 'error' | 'silent'): void
```

```ts
logger.info({
  event: 'cart_item_added',   // canonical snake_case name, past tense
  outcome: 'success',
  durationMs: 12,
  cartId, userId,             // high-cardinality identifiers
  itemCount, subtotalKobo,    // business context
});
```

Two rules that carry the most weight:

1. **One wide event per operation**, not a scatter of one-line logs. If you find
   yourself logging at three points inside one function, you want one event at
   the end with the results.
2. **Never log a credential, a token, a full address, or a request body.**
   `scrub()` redacts known-sensitive keys as a backstop, but it is not a licence
   to be careless.

## Schemas

`@/schemas`. **The Edge Function validates the same shapes against the same
source of truth.** If A2 needs a schema that is not here, it gets added here
first — never duplicated.

```ts
addressSchema / checkoutSchema   // the seven fulfilment fields, in form order
ADDRESS_FIELDS                    // ['fullName','email','phone','addressLine1',
                                  //  'addressLine2','city','state','country']
createOrderPayloadSchema          // { shipping: <address> } — nothing else
createOrderResultSchema           // { orderId, reference, totalKobo, emailSent }
                                  //  the four keys the client reads. The function
                                  //  also returns `order` and `items`; see its
                                  //  README for the full 200 body
normalisePhone(value: string)     // any accepted input -> '+2348030000000'

type FieldErrors = Record<string, string | undefined>;
const FORM_ERROR_KEY = 'form';

checkoutFieldErrors(error: ZodError): FieldErrors  // issues -> first message per path
fieldErrorsFrom(error: unknown): FieldErrors       // ZodError | Error | unknown
hasFieldError(errors: FieldErrors, field: string): boolean
```

Wire names are camelCase (`addressLine1`) because the payload is JSON posted to an
Edge Function.

```tsx
const result = checkoutSchema.safeParse(values);
if (!result.success) setErrors(checkoutFieldErrors(result.error));
<Input label="City" error={errors.city} value={values.city} onChange={…} />
```

`createOrderPayloadSchema` **strips** unknown keys, so a hostile client adding
`totalKobo` or `userId` gets a payload that does not contain them. That is the
security property: the server has nowhere to be fooled.

`emailSent: false` means the order **exists** and the email may not arrive. Word
the confirmation that way; never imply the order failed.

## Supabase client and types

```ts
// src/lib/supabase.ts
getSupabaseClient(): Supabase        // memoised; throws ConfigurationError if unset
getSession(): Promise<Session | null>
assertNoSecretCredentials(): void    // runs at module load; throws if a secret is present
```

**Only publishable credentials, ever.** A `VITE_`-prefixed service-role key or a
service-role JWT throws at module evaluation — fail-fast, because a leaked key is
a production incident and the cheapest place to catch it is before the app
renders.

The client is created **lazily**. Importing the module never throws for a
*missing* configuration, only for a *forbidden* one — so the shell renders and
each hook reports a clean error state.

`src/lib/supabase.types.ts` is hand-written from SPEC.md. The data agent
regenerates it with `supabase gen types typescript --local`. **If that changes
anything, that is a contract change** → `CONTRACT-REQUESTS.md`, not a silent
patch. Domain aliases (`Product`, `Cart`, `Order`, …) live at the bottom of the
file; import those, not the `*Row` names.

## Product images

**Three agents render product photography and none of them should be inventing
how.** `src/lib/images.ts` and `src/components/media/ProductImage.tsx` are
frozen contract surface. The media agent owns `product-images/**` (except the
manifest *shape*), `scripts/**`, and `docs/IMAGES.md`.

### Ownership, precisely

| Path | Owner |
| --- | --- |
| `src/lib/images.ts` | **frozen.** Nobody edits. |
| `src/components/media/ProductImage.tsx` | **frozen.** Nobody edits. |
| `product-images/manifest.json` — the **shape** | **frozen.** This section is the schema. |
| `product-images/manifest.json` — the **contents** | the media agent fills it |
| `product-images/**` (derivatives) | the media agent generates them |
| `scripts/**` | the media agent |
| `docs/IMAGES.md` | the media agent |

**If your photo does not fit this schema, that is a `CONTRACT-REQUESTS.md`
entry, not a schema edit.** Adding a field, renaming one, or loosening a rule
breaks every renderer.

### Why a manifest rather than Storage

PLAN §4 commits the derived derivatives, so the browser reads the manifest at
**build time** and gets real URLs immediately: no Storage round trip, no spinner
before the first image can even start, and no dependency on the data layer.
`products.image_path` still records the Storage object for the record; the
storefront renders from the manifest.

### The manifest

`product-images/manifest.json` is committed. It currently holds
`{ "version": 1, "products": {} }` and every lookup returns `null` — which
renders a neutral placeholder, never a broken image. The media agent fills
`products` as the photographs land.

```jsonc
{
  "version": 1,                    // exactly 1. A new version is a schema change.
  "products": {
    "<slug>": {                    // keyed by slug, matching products.slug
      "slug": "<slug>",            // must equal the key
      "alt": "Milled steel rule resting on raw concrete, hard light from the left.",
      "attribution": {
        "sourceUrl": "https://unsplash.com/photos/…",   // a real URL
        "photographer": "A. Photographer",
        "license": "Unsplash License"
      },
      "images": [                  // at least one
        {
          "ratio": "4x3",          // '4x3' | '1x1'
          "role": "main",          // 'main' | 'thumb'. Informational.
          "width": 640,            // px, integer
          "height": 480,           // px, integer, must match `ratio`
          "webp": "product-images/desk/steel-rule-4x3-640.webp",   // repo-relative
          "jpeg": "product-images/desk/steel-rule-4x3-640.jpg",    // same crop
          "bytes": 61000
        }
      ]
    }
  }
}
```

Equivalent TypeScript — these are the names the code uses:

```ts
type ImageRatio = '4x3' | '1x1';
type ImageRole = 'main' | 'thumb';

interface ProductImageVariant {
  ratio: ImageRatio;
  role: ImageRole;
  width: number;
  height: number;
  webp: string;   // repo-relative
  jpeg: string;   // repo-relative
  bytes: number;
}

interface ProductImage {
  slug: string;
  alt: string;
  attribution: { sourceUrl: string; photographer: string; license: string };
  images: ProductImageVariant[];
}

interface ProductImageManifest {
  version: 1;
  products: Record<string, ProductImage>;
}
```

Four rules the validator enforces, because each one is a bug that would otherwise
ship silently:

1. `slug` must equal its key — otherwise one product's photo renders under
   another product's name.
2. `width`/`height` must match the declared `ratio` — otherwise the box the
   browser reserves is not the box the image fills.
3. No two variants at the same ratio **and** width — `srcSet` would be ambiguous.
4. `alt` is required and non-empty. "No alt text" is `decorative` on the
   component, not an empty string in the manifest.

A manifest that breaks any of these **throws when `@/lib/images` is first
imported**, with a message naming the product and the field. That is deliberate
and different from the data hooks: the database may legitimately be missing
mid-build, but a malformed committed file is a merge mistake, and it should stop
the work rather than ship broken images.

In practice it stops two things, both automatic:

- **`npm run ci:check` fails**, which is what PLAN §7's CI job runs.
   `tests/unit/images.test.ts` validates the committed file, so a bad manifest is
   a red build before it can be merged.
- **The app fails loudly at import** rather than rendering broken photographs.

It does not stop `npm run build` on its own: until a page imports
`<ProductImage>`, the module is tree-shaken out of the entry bundle and the
bundler never evaluates it. That is fine — the unit suite is the gate, and it
has no such blind spot.

### The lookup API — `@/lib/images`

```ts
getProductImage(slug: string): ProductImage | null
getImageUrls(slug: string, ratio: ImageRatio): ImageUrls | null

interface ImageUrls {
  src: string;       // largest committed WebP for this ratio
  srcSet: string;    // every committed WebP for this ratio, ascending: "a.webp 320w, b.webp 640w"
  jpeg: string;      // JPEG fallback — this is what a <picture>'s <img> uses
  width: number;     // intrinsic width of `src`, px
  height: number;    // intrinsic height of `src`, px
  alt: string;       // verbatim from the manifest
}
```

- `getImageUrls` returns `null` for an **unknown slug** and for a **known slug
  with no image at that ratio**. Callers get `null`, not a broken image, and draw
  their own placeholder.
- `srcSet` carries every width **committed for that ratio**, ascending —
  irrespective of the order they appear in the manifest.
- `src` is the largest committed width, so a client that ignores `srcSet` still
  gets the good image.
- **Alt text is never invented here.** It comes from the manifest or it is not
  there.
- No React in this module. It is a pure lookup.

Also exported, for tooling and for the media agent: `productImageManifestSchema`,
`parseProductImageManifest(input)`, `loadProductImageManifest()`,
`createImageLookup(manifest)`, `productImages`, `IMAGE_RATIOS`, `IMAGE_ROLES`.

### `<ProductImage />` — `@/components/media/ProductImage`

Use this instead of your own `<img>`. It renders the `<picture>`, reserves the
box, and owns the missing-image state.

```tsx
<ProductImage slug={product.slug} ratio="4x3" sizes="(min-width: 768px) 33vw, 100vw" />
```

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `slug` | `string` | — | required. The product's slug |
| `ratio` | `'4x3' \| '1x1'` | `'4x3'` | 4:3 is the catalogue's main grid ratio |
| `sizes` | `string` | — | passed to the WebP `<source>`. **Set it on a grid**, or the browser picks a larger variant than it needs |
| `alt` | `string` | manifest `alt` | prefer `decorative` over overriding this |
| `decorative` | `boolean` | `false` | opt-in: empty alt **and** `aria-hidden` |
| `lazy` | `boolean` | `true` | native `loading`. Overridden by `priority` |
| `priority` | `boolean` | `false` | above-the-fold hero: `loading="eager"` **and** `fetchPriority="high"` |
| `className` | `string` | `''` | on the wrapper: grid placement, border treatment |
| `imgProps` | `ImgHTMLAttributes` | — | forwarded to the `<img>` for `data-*` and test hooks |

Three guarantees, all tested:

1. **Explicit `width`/`height` on the `<img>` plus `aspect-ratio` on the
   wrapper.** Non-negotiable: that pair is what stops the grid jumping while
   the photograph loads.
2. **Inside `<picture>`, the `<img>` `src` is the JPEG**, because that is the
   fallback for browsers that skipped the WebP `<source>`. Reach for `src`
   yourself only when you are *not* using `<picture>` — a bare `<img>`, an Open
   Graph tag, a CSS background.
3. **A missing image is a neutral panel of the same size** — token surface, a
   hairline edge, a small mono `No image`. No broken-image glyph, no layout
   jump, nothing for a screen reader to read out.

`decorative` is opt-in, not the default. Almost every product photo here carries
information; reach for it only when the image genuinely repeats adjacent text —
a cart thumbnail beside a product name that is already in the row.

## Commands

```bash
npm run dev          # Vite dev server
npm run build        # typecheck + production build
npm run typecheck    # tsc -b
npm run check        # Biome lint + format check
npm run check:fix    # Biome, writing fixes
npm run ci:check     # typecheck + check + test:unit   ← run before you push
npm test             # everything
npm run test:unit    # jsdom, no Docker needed
npm run test:func    # needs the local stack
```

Local database — **never type a raw `supabase` command**:

```bash
npm run db:start     # boot the shared stack
npm run db:reset     # migrations + seed from scratch  (Foundation / A1 / A7 ONLY)
npm run db:stop
npm run db:status
npm run db:functions # serve create-order with supabase/.env.local
```

> **One stack, many worktrees.** `supabase/config.toml` pins `project_id = "kanso"`,
> so every worktree attaches to the same containers. Do not change it. And do not
> run `db:reset` casually — it wipes every other agent's test data mid-run.

Functional tests read connection values from the **environment**, never from
`.env.local` (which points at the remote project). `npm run test:func` obtains
them itself — from the environment if they are already there (the CI path), or
by parsing `supabase status -o env` — checks the stack is actually answering,
and then runs Vitest:

```bash
npm run db:start     # once per machine
npm run test:func
```

> Do not write `eval "$(supabase status -o env)" && npm run test:func`. The CLI
> prints bare `KEY="value"` lines with no `export`, so that `eval` sets shell
> variables `npm run` does not pass to its child — the suite found no connection,
> skipped every test, and reported `1 passed | 28 skipped`. The suite now fails
> loudly instead, but the runner is what makes the incantation unnecessary.

`.env.local` needs only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
The Edge Function secrets (`SUPABASE_SERVICE_ROLE_KEY`, `MAILGUN_*`, `APP_URL`)
belong in Supabase — see `.env.example`.