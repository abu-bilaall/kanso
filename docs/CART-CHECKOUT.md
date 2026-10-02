# A5 — cart and checkout: open items for integration

Requests from **A5** (`feat/cart-checkout`) against the frozen surface in
[`CONTRACTS.md`](./CONTRACTS.md).

[`CONTRACT-REQUESTS.md`](./CONTRACT-REQUESTS.md) is the integration-owned log and
was closed by the integration pass; A5 did not edit it. The five requests raised
during the original build are recorded here instead, with their current status
against `main` as of the `feat/cart-checkout` merge.

| # | Request | Status |
| --- | --- | --- |
| 1 | Freeze the `create-order` error envelope | **Resolved** — see below |
| 2 | `AuthCallbackPage` honours the checkout return after OAuth | **Open** |
| 3 | `--spacing-md/-lg/-xl` are never generated | **Closed** on `chore/integration-2` |
| 4 | `useCart` is per-call-site, so the cart badge never clears | **Closed** on `chore/integration-2` |
| 5 | An anonymous visitor cannot build a cart | **Open — needs a product decision** |

> Items 3 and 4 below were closed by the integration pass on
> `chore/integration-2`; see [`CONTRACT-REQUESTS.md`](./CONTRACT-REQUESTS.md)
> § *Resolutions — integration pass 2* for what was actually done. Items 2 and 5
> are still open and are still the right shape as written below.

---

## 1. The `create-order` error envelope — resolved, and what changed

**Closed.** `supabase/functions/create-order/README.md` now documents the wire
format, and A5 is written to that document rather than to its earlier guess.

The guess was wrong in one place worth recording, because it is the kind of
mistake that produces a wrong number rather than an error: A5 originally read
`productId` and `available` off the **top level** of the failure body. The
documented shape is **flat** with the machine context nested:

```jsonc
{ "code": "insufficient_inventory",
  "message": "Only 2 of Oak Pen Cup left in stock.",
  "retryable": false,
  "details": { "product": "oak-pen-cup", "productId": "…",
               "productName": "Oak Pen Cup", "requested": 3, "available": 2 } }
```

Reading `available` off the top level silently yields `undefined` — the
customer loses the count SPEC requires the message to carry.
`toCreateOrderError` now reads `details`, honours the server's own `retryable`
flag, and carries `details.fieldErrors` through so a `422` renders inline under
the control it names. A nested `{ error: { … } }` envelope is still accepted as a
fallback, because being wrong about the envelope costs a generic message and
not accepting it costs more.

`tests/unit/checkout/createOrder.test.tsx` pins the documented shape verbatim.

**Verified against the real function**, not a mock: a live `create-order` with a
product drained to zero stock returns `409` and the browser renders its sentence
unchanged — *"Dot Grid Notebook has sold out. Remove it from your cart to
continue."* The page stays on `/checkout`; no order is confirmed.

---

## 2. `AuthCallbackPage` must honour the checkout return — OPEN

**What A5 built.** `src/features/checkout/returnIntent.ts`. Before starting
Google sign-in, checkout writes `/checkout` to `sessionStorage` under
`kanso:return-to` and passes `redirectTo` as
`<origin>/auth/callback?returnTo=%2Fcheckout`. Both channels are written;
neither is read yet.

**What is needed.** `src/pages/auth/AuthCallbackPage.tsx` is still the 13-line
placeholder, so the return has no reader and a signed-out visitor who reaches
`/checkout` is sent to Google and then to whatever the placeholder renders.
Resolve the destination in this order, then `navigate`:

1. `?returnTo=`, **only** when it passes a same-origin check: a single leading
   `/`, not `//` or `/\`, and no scheme. `//evil.com` is protocol-relative and
   is an open redirect otherwise.
2. `sessionStorage.getItem('kanso:return-to')`, under the same check.
3. `/account`.

Remove the `sessionStorage` key before navigating. It is one-shot; a stale intent
must never bounce somebody back to a checkout page days later. A5's checkout
also consumes it on mount, so the marker cannot loop.

**Deployment note, not a code change.** The Supabase redirect allow-list has to
contain the app origin. `supabase/config.toml` currently lists only
`https://127.0.0.1:3000` and is shared across worktrees, so it belongs in the
integration pass rather than in a branch.

---

## 3. `--spacing-md/-lg/-xl` are never generated — CLOSED on `chore/integration-2`

**What I am building.** A5: cart, checkout and order confirmation, all inside
`PageShell`.

**The exact change.** Add three aliases to the `@theme inline` block in
`src/styles/tokens.css`, beside the `--spacing-xs` / `--spacing-sm` entries that
are already there:

```css
--spacing-md: var(--k-space-md);
--spacing-lg: var(--k-space-lg);
--spacing-xl: var(--k-space-xl);
```

**Why the existing surface cannot do it.** The `@theme` block declares only
`--spacing-xs` and `--spacing-sm`, so Tailwind v4 generates `gap-xs` and
`gap-sm` and nothing else. `gap-md`, `gap-lg`, `gap-xl`, `pt-md`, `pt-lg` and
`pb-xl` are not utilities at all — they compile to nothing, silently. Measured
in the running app:

| Class | Resolves to |
| --- | --- |
| `gap-8` | `32px` |
| `gap-lg` | *not generated* |
| `gap-md` / `gap-sm` / `gap-xl` | *not generated* |

Still true on `main`: `PageShell` line 86 uses `pt-md … md:pb-xl md:pt-lg` and
line 88 uses `flex flex-col gap-lg`. So **every page's top-level children are
stacked with zero gap** and `<main>` contributes no top padding. Before A5
worked around it, the confirmation screen ran its items block straight into the
"Shipping to" heading.

**What I built in the meantime.** Each A5 page wraps its content in its own
`flex flex-col gap-6` (24px, which is `--k-space-lg`). `PageShell` and
`tokens.css` were not edited — both are frozen and shared.

**Who else depends on it.** Every page, including A4's storefront and A6's
account page.

**Resolved on `chore/integration-2`.** Applied in the token layer, which is
where it belongs: `--spacing-md`, `-lg` and `-xl` are in `@theme inline` now,
each pointing at the `--k-space-*` primitive that was already declared. The
three `flex flex-col gap-6` wrappers this agent put on the cart, checkout and
confirmation pages existed only to stand in for the missing `gap-lg`, and all
three are gone; the shell's own `gap-lg` does that work now. The sweep that
found this also found `font-label`, `focus:border-hard` and
`focus:bg-surface-container-high` — see the contract-requests log.

---

## 4. `useCart` is per-call-site, so the cart badge never clears — CLOSED on `chore/integration-2`

**The exact change.** Either hoist cart state into `AuthProvider` (or a new
`CartProvider`) so every `useCart()` call site reads one instance and a mutation
in one invalidates the rest, or give `useAsyncResource` a cache keyed by fetcher
identity with an `invalidate('cart')` that mounted consumers observe.

**Why the existing surface cannot do it.** `useAsyncResource` is `useState` plus
`useEffect` with no shared store. `DesktopRail`, `MobileHeader` and the page
underneath are three independent carts, so after `create-order` closes the cart
server-side the badge keeps showing the pre-checkout count until a full page
load — on the confirmation screen, directly contradicting the order the customer
just placed.

**What I built in the meantime.** Nothing, deliberately. A `cart.refresh()` in
the checkout page would refresh only the copy in a component that unmounts
seconds later, and shipping it would look like a fix.


**Resolved on `chore/integration-2`.** Cart state moved into one external
store, `src/hooks/internal/cartStore.ts`, which every `useCart()` call site
subscribes to. Measured in the running app with a signed-in user: four mounted
consumers (rail, mobile header, tab bar, page) issue **one** `carts` read, and a
`removeItem` on the cart page clears the rail badge and the mobile header badge
in the same view with one further read — no reload, no manual refresh. The
public API and return shape in `docs/CONTRACTS.md` are unchanged; `useCart`
reads the store through `useSyncExternalStore` and derives the same fields it
always returned, including `status: 'loading'` while the session settles.
`tests/unit/cart/sharedCartStore.test.tsx` pins all three.
---

## 5. An anonymous visitor cannot build a cart — OPEN, needs a decision

**Observation.** `useCart` runs its fetcher only when `isAuthenticated`, and
`addItem` / `setItemQuantity` reject with `unauthenticated` when there is no
active cart. A signed-out visitor therefore cannot put anything in a cart
anywhere in the app, and DESIGN.md's journey —
`Home → Catalogue → Product → Cart → Google Auth → Checkout` — is not reachable
in V1 as drawn. The sign-in gate has to fire before the first add, not at
checkout.

**Why it needs integration rather than a note.** Either the journey moves
(checkout follows Google Auth, and the storefront's add-to-cart prompts for
sign-in first — a product call), or carts become anonymous-capable and merge into
the user's cart on sign-in (a `carts.user_id` that may be NULL, plus a merge path
in `create-order` — a schema and RLS change). Both are larger than a contract
tweak.

**What I built in the meantime.** Checkout sends an unauthenticated visitor
through Google sign-in and returns them there, which is A5's brief and is correct
either way. The cart page shows an honest empty state for an anonymous visitor
and says the cart travels with the account.
