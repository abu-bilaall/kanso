# Contract requests

Requests for changes to the frozen surface in [`CONTRACTS.md`](./CONTRACTS.md),
raised by the agents building against it. Reviewed and applied once, centrally,
during integration — see [How to ask for a change](./CONTRACTS.md#how-to-ask-for-a-change).

Nothing here blocked work. Each entry says what was assumed and what was built
against that assumption, so integration can either ratify it or change one file.

---

## A2 — freeze the `create-order` error envelope

**What I am building.** A5: the checkout form and the order confirmation screen,
including the state where the server refuses an order because stock has moved.

**The exact change.** Add the failure half of the `create-order` contract to
`docs/CONTRACTS.md` §Schemas, next to `createOrderResultSchema`:

```ts
export const createOrderErrorSchema = z.object({
  error: z.object({
    /** One of APP_ERROR_CODES, so the client never invents a code. */
    code: z.enum(APP_ERROR_CODES),
    /** Written for a human and safe to render. */
    message: z.string(),
    /** Present on `insufficient_inventory`. */
    productId: z.string().optional(),
    /** Present on `insufficient_inventory`; units that actually exist. */
    available: z.number().int().nonnegative().optional(),
  }),
});
```

Suggested statuses: `400` validation · `401` unauthenticated · `409`
`insufficient_inventory` · `429` rate limited · `5xx` server.

**Why the existing surface cannot do it.** `createOrderResultSchema` covers only
the success path. Checkout's most important failure — an order that cannot ship
because someone else bought the last unit — arrives as a `FunctionsHttpError`
whose body is untyped, and SPEC requires the customer to be told *which* product
and *how many* are left. Without a frozen shape the client has to guess, and
guessing wrong means either a genericised message or a wrong one.

**What I built in the meantime.** `src/features/checkout/createOrder.ts` reads
both `{ error: { … } }` and a flat `{ code, message }`, trusts `code` only when
it is in `APP_ERROR_CODES`, and passes the server's `message` through verbatim
onto the screen. If A2's shape differs, only `toCreateOrderError` changes.

**Who else depends on it.** A7 (integration QA) will need to assert this
behaviour end to end; the local-stack functional tests for checkout hit it.

---

## A6 — honour the checkout return after Google sign-in

**What I am building.** A5: `/checkout` for a visitor who is not signed in. They
are sent through Google OAuth and must come back to checkout, not to `/account`.

**The exact change.** `AuthCallbackPage` should resolve its post-sign-in
destination in this order, then `navigate` there:

1. `?returnTo=` from the query string, **only** when it passes a same-origin
   check: must start with a single `/`, must not start with `//` or `/\`, and
   must not carry a scheme. `//evil.com` is protocol-relative and is an open
   redirect otherwise.
2. `sessionStorage.getItem('kanso:return-to')`, under the same check.
3. `/account`.

Whichever source answers, remove the `sessionStorage` key before navigating. It
is one-shot: a stale intent must never bounce somebody back to a checkout page
days later.

**Why the existing surface cannot do it.** The frozen `signInWithGoogle` takes a
`redirectTo` and nothing else, and the default target is `<origin>/auth/callback`
with no way to say where to go next. The intent therefore has to travel in the
URL that `useAuth` hands to Supabase, and something has to read it. Checkout
writes both channels (`src/features/checkout/returnIntent.ts`); only the reader
is missing, and the reader is A6's page.

**Who else depends on it.** The rail's SIGN IN and the account page's sign-out →
sign-in round trip reach the same callback and will want the same behaviour.

**Deployment note, not a code change.** The Supabase project's redirect
allow-list has to contain the app origin (for local work,
`http://localhost:5173/**`; for deploy, the Netlify origin). `supabase/config.toml`
currently lists only `https://127.0.0.1:3000` and is shared across worktrees, so
nobody should edit it unilaterally — it belongs in the integration pass.

---

## Foundation — `--spacing-md/-lg/-xl` are never generated, so the shell has no rhythm

**What I am building.** A5: cart, checkout and order confirmation. All three
render inside `PageShell`.

**The exact change.** Add the three missing aliases to the `@theme inline` block
in `src/styles/tokens.css`, next to the `--spacing-xs` / `--spacing-sm` entries
that are already there:

```css
--spacing-md: var(--k-space-md);
--spacing-lg: var(--k-space-lg);
--spacing-xl: var(--k-space-xl);
```

**Why the existing surface cannot do it.** The `@theme` block declares only
`--spacing-xs` and `--spacing-sm`, so Tailwind v4 generates `gap-xs` and
`gap-sm` and nothing else. `gap-md`, `gap-lg`, `gap-xl`, `pt-md`, `pt-lg` and
`pb-xl` are **not utilities at all** — they compile to nothing, silently.

Measured in the running app, reading `getComputedStyle` off a probe element:

| Class | Resolves to |
| --- | --- |
| `gap-8` | `32px` |
| `gap-lg` | *not generated* |
| `gap-md` / `gap-sm` / `gap-xl` | *not generated* |

The consequence is in `PageShell` itself: its content wrapper is
`flex flex-col gap-lg`, so **every page's top-level children are stacked with
zero gap**, and `<main>`'s `pt-md md:pt-lg pb-xl` contribute no padding. On the
confirmation screen the items block runs straight into the "Shipping to" heading
with nothing between them.

**What I built in the meantime.** Each of my three pages wraps its content in
its own `flex flex-col gap-6` (24px, which is `--k-space-lg`), so A5's surfaces
have correct rhythm without depending on the missing token. I did not edit
`PageShell` or `tokens.css` — both are frozen and shared.

**Who else depends on it.** Every page in the app. A4's storefront and A6's
account page inherit the same zero gap and zero top padding, whether or not they
notice.

---

## Foundation — `useCart` is per-call-site, so the cart badge never clears

**What I am building.** A5: the cart, and the redirect from `/checkout` to
`/order/:id` after a successful order.

**The exact change.** One of:

- hoist cart state into `AuthProvider` (or a new `CartProvider`) so every
  `useCart()` call site reads the same instance and a mutation in one invalidates
  the rest; or
- give `useAsyncResource` a cache keyed by fetcher identity, with an
  `invalidate('cart')` that mounted consumers observe.

Either way, `DesktopRail`'s and `MobileHeader`'s badges need to update when
`create-order` closes the cart.

**Why the existing surface cannot do it.** `useAsyncResource` is `useState` plus
`useEffect` with no shared store, so each `useCart()` call site runs its own
query and holds its own copy. `DesktopRail`, `MobileHeader` and the page under it
are three independent carts. After checkout the cart is closed server-side and
the order exists — but the rail keeps showing the pre-checkout item count until a
full page load, so the badge contradicts the order the customer just placed.

**What I built in the meantime.** Nothing, deliberately. I removed the
`cart.refresh()` call that would have refreshed only the unmounting page's copy.
A local refresh is not a fix here, and shipping it would look like one.

**Who else depends on it.** Every surface with a cart badge, and A7, whose
integration pass will see a stale count on the confirmation screen.

---

## Foundation — an anonymous visitor cannot build a cart

**What I am building.** A5: `/cart` and `/checkout`, which read `useCart`.

**Observation, not a change request for my branch.** `useCart` runs its fetcher
only when `isAuthenticated`, and `addItem` / `setItemQuantity` reject with
`unauthenticated` when there is no active cart. So a signed-out visitor cannot
add anything to a cart anywhere in the app, and DESIGN.md's journey —
`Home → Catalogue → Product → Cart → Google Auth → Checkout` — is not reachable
in V1 as drawn: the sign-in gate has to fire before the first add, not at
checkout.

**Why it is worth a decision rather than a note.** Either the journey moves
(checkout comes after Google Auth, and the storefront's add-to-cart prompts for
sign-in first — a product call), or carts become anonymous-capable and are merged
into the user's cart on sign-in (a schema and RLS change: a `carts.user_id` that
may be NULL, plus a merge path in `create-order`). Both are larger than a
contract tweak, so integration should choose rather than inherit my reading.

**What I built in the meantime.** Checkout sends an unauthenticated visitor
through Google sign-in and returns them there, which is the brief's instruction
and works regardless of which way the decision goes. The cart page shows an
honest empty state for an anonymous visitor and says the cart travels with the
account.
