# Contract requests

> **Status: a resolved log, not guidance.** Every decision here is history —
> what was asked for, what was actually done, and why. Nothing in this document
> is a rule you follow. The surface these requests were raised against is still
> described in [`CONTRACTS.md`](./CONTRACTS.md); if you are changing code, that
> is the document to read.
>
> Layout: resolution tables first, newest last, then the original request text
> left untouched so the reasoning survives alongside the answer. See
> [`docs/README.md`](./README.md).

---

## Resolutions

**Closed on `chore/integration`.** Each of the nine requests below, and what was
actually done. The original text is left untouched so the requester can see
their own reasoning; this is the answer.

| § | Request | Resolution |
| --- | --- | --- |
| 1 | Add `decrement_inventory` (and `create_order_atomic`) to `Functions` | **Applied.** Both, in one edit, matching `supabase gen types typescript --local` exactly. The local casts in `tests/functional/db/inventory.test.ts` and the `InventoryService` interface are gone — `client.rpc(...)` is typed now. |
| 2 | `carts` / `orders` `Relationships` | **Left as written, with one correction.** `Relationships: [UserFk]` stays: it is inert and harmless. But `UserFk` named the constraint `profiles_id_fkey` for two tables that do not have it, so the type is now `UserFk<'carts_user_id_fkey'>` / `UserFk<'orders_user_id_fkey'>` — a widening, so nothing that compiled before stops compiling, and the file no longer states a constraint name that is not in the database. |
| 3 | `Insert` marks nullable columns optional | **Left as written.** The hand-written shape is stricter than the generator's, and the difference only ever widens the database relative to the contract. Changing it would touch five agents' insert calls for no behavioural gain. |
| 4 | Extra `graphql_public` schema key | **Left as written.** Cosmetic, and only appears if the file is regenerated wholesale. |
| 5 | `eval "$(supabase status -o env)"` does not export | **Applied, and then some.** `npm run test:func` now runs `scripts/functional-env.mjs`, which takes the values from the environment when they are there (the CI path), otherwise parses `supabase status -o env` itself, and refuses to start if the stack is not answering. `tests/setup/functional.ts` **throws** instead of skipping, so there is no longer a code path that reports success without asserting anything. `tests/unit/functional-suite-guard.test.ts` pins both halves, including a subprocess run that must exit non-zero. |
| 6 | `products.image_path` is null in the seed | **Not actioned — blocked on the media agent, deliberately.** No product images exist yet, so there is no Storage object to point at. The storefront renders from the committed `product-images/manifest.json`, which §6 itself records, so the column being null breaks nothing today. It becomes a one-line `update` in `supabase/seed.sql` when the media agent names the paths; the convention to follow is in §6. |
| 7 | `create_order_atomic` | **Landed** as `supabase/migrations/20261002090500_create_order_atomic.sql`, after `decrement_inventory` which it calls. `revoke execute … from public, anon, authenticated` and `grant … to service_role` are in the migration, not applied by hand. The one deviation from the SQL in §7: `set search_path = ''` rather than `public`, matching the other migrations. Every table and function the body touches is schema-qualified, so nothing resolves differently. `tests/functional/db/order-commit.test.ts` proves a signed-in browser gets `42501` while the service role still commits, and that a `PGRST202` (function deleted) would fail the test too. |
| 8 | `allowImportingTsExtensions` | **Applied** in `tsconfig.app.json`, together with the change it makes unnecessary: `supabase/functions/**` now imports its own modules with `.ts` specifiers, and the ten `supabase/functions/_shared/*.js` resolver bridges are deleted. `deno check create-order/index.ts` is clean. |
| 9 | Export `createLogger` from `src/lib/logger.ts` | **Applied.** `createLogger` and `LogSink` are exported, `import.meta.env` is read through a widened cast, and `./errors` is imported as `./errors.ts` so the module loads under Deno. `supabase/functions/_shared/logger.ts` is now a re-export plus the edge environment context. |

Merging the two loggers surfaced a real defect in the browser copy: its level
gate was `if (level === 'info' && logLevel === 'error') return`, so the default
`info` gate silently discarded **every** error line. `LogLevelGate` is documented
in `docs/LOGGING.md` as a minimum severity, and the Edge Function's copy already
implemented that. The line is removed; the gate is now a threshold.


---

## Resolutions — integration pass 2

**Closed on `chore/integration-2`.** Two more defects in the foundation layer,
both found downstream and both fixed at the source. Neither needed a change to
`docs/CONTRACTS.md`: the documented contracts hold exactly as written.

| # | Request | Resolution |
| --- | --- | --- |
| 10 | `--spacing-md` / `-lg` / `-xl` are never generated | **Applied.** Three lines added to `@theme inline` beside the `--spacing-xs` / `--spacing-sm` entries already there, each pointing at the primitive that was always declared: `--spacing-md: var(--k-space-md)`, `-lg`, `-xl`. The scale is extended, not replaced — `gap-lg` and `gap-6` are the same 24px. The three `flex flex-col gap-6` wrappers A5 put on the cart, checkout and confirmation pages existed only to stand in for the missing `gap-lg`; all three, and their comments, are gone. |
| 11 | `useCart` is per-call-site, so the badge never clears | **Applied.** Cart state now lives in one external store, `src/hooks/internal/cartStore.ts`, and every `useCart()` call site subscribes to it. `useCart`'s public API and return shape are unchanged, `docs/CONTRACTS.md` § *Hooks* is untouched, and no new provider has to be mounted. Concurrent consumers share one request; a mutation in any of them republishes to all of them. |

**Two more dead class names, found by the same sweep and fixed the same way.**

- `font-label` appeared on 28 call sites and generated nothing. Stitch's own
  config puts Archivo on both `body-lg` and `label-lg`, so the Kanso name for
  that face is `--font-sans`; `--font-label: var(--font-sans)` makes the class
  say what it means instead of rendering nothing.
- `focus:border-hard` (the skip link) and `focus:bg-surface-container-high`
  (`Input`, `Select`) also generated nothing. The first because `border-hard` was
  a rule inside `@layer utilities`, which gets no variants; the three shared
  utilities are `@utility` declarations now. The second because it is the
  Stitch token name — Kanso calls that colour `surface-high`.

**And a guard, so this cannot come back silently.** `npm run check:classes`
compiles the real stylesheet and reports every class name `src/` uses for which
Tailwind emits nothing. It found 10 before the fix and 0 after.
`tests/unit/styles/designTokens.test.ts` pins the same ground at unit level;
all five of its tests fail against the pre-fix `tokens.css`.

**Not actioned at the time of this pass.** A5's other two requests were left open
here and documented in [`CART-CHECKOUT.md`](./CART-CHECKOUT.md) § 2 and § 5:
the `AuthCallbackPage` return-to reader was A6's page to build, and anonymous
carts needed a product decision plus a schema and RLS change.

**Both have since moved**, and neither needed a change here:

| § | Request | Where it landed |
| --- | --- | --- |
| — | `AuthCallbackPage` honours the checkout return | Built on `feat/account-auth` — § 11 below, now RESOLVED. |
| — | An anonymous visitor cannot build a cart | Decided and built: the gate fires at the first add, not at checkout. `ProductPage` catches the `unauthenticated` rejection and offers sign-in; `ProductCard` hides its quick-add when signed out. The journey moved rather than the schema — see [`CART-CHECKOUT.md`](./CART-CHECKOUT.md) § 5. |

---

## Still open

One request in this document has not been actioned. It is a real defect, not a
preference, and it is not reachable from a frozen file without one.

| § | Request | Status |
| --- | --- | --- |
| 10 | `max-w-<name>` resolves against `--spacing-<name>`, shadowing the container scale | **Open.** The fix is a `--container-*` block in `src/styles/tokens.css`, which belongs to the design-token owner. `npm run check:classes` cannot catch it — the class generates a rule, just with the wrong value — and A4, A5 and A6 have all had to reach for `max-w-prose` or a numeric name instead. |

---
---

**What you are building:** the data layer — `supabase/migrations/**`,
`supabase/seed.sql`, `docs/DATA-MODEL.md`, `tests/functional/db/**` on
`feat/data-layer`.

**Rule followed:** `src/lib/supabase.types.ts` was not edited. The migrations
were changed until the generated types matched it. Five differences remain that
no migration can remove; they are listed below in the order they matter.

**Method.** `supabase gen types typescript --local` was run against the migrated
database and compared with the hand-written file by a two-way `tsc` assignability
check over every table's `Row`, `Insert`, `Update` and `Relationships`, plus
`Enums` and `Functions` — 74 assertions in total. The compiler, not a human,
enumerated the differences. It is reproduced in the branch report.

**What matches, exactly:** the table set; every `Row` column, type and
nullability; every `Update`; the `Enums` unions; and the `Relationships` for
`cart_items` and `order_items` including the constraint names
`cart_items_cart_id_fkey`, `cart_items_product_id_fkey`,
`order_items_order_id_fkey` and `order_items_product_id_fkey`. The hand-written
`Insert` shapes also match on every `not null` column, which took three
migration decisions that would otherwise have gone the other way: no default on
`carts.status`, no default on `orders.status`, and no default on
`products.inventory`.

---

## 1. `Functions` — add `decrement_inventory` (blocks A2)

**Who else depends on it:** A2, at the point where it decrements stock. Nothing
compiles against it today; the functional suite reaches it through a narrow
local cast, which is the only `as` in the test code.

The inventory decrement has to be one statement evaluated by the database:

```sql
update products set inventory = inventory - $qty where id = $id and inventory >= $qty;
```

The Data API can only assign a *literal* to a column, so a REST call would have
to send `inventory = 4` computed from a value it read a moment earlier. Two
requests that both read 5 would both send 4, both satisfy `inventory >= 1`
re-evaluated after the first commits, and both succeed — leaving 4 instead of 3.
A read-then-write is worse: it oversells outright. So the arithmetic has to live
in the database, and only A1 writes SQL. The function is
`SECURITY DEFINER` with `execute` revoked from `anon` and `authenticated`, so a
browser cannot decrement stock.

**The exact change** to `src/lib/supabase.types.ts`, replacing
`Functions: Record<never, never>`:

```diff
     Enums: {
       product_category: ProductCategory;
       cart_status: CartStatus;
       order_status: OrderStatus;
     };
+    Functions: {
+      decrement_inventory: {
+        Args: { p_product_id: string; p_quantity: number };
+        Returns: number;
+      };
+    };
     CompositeTypes: Record<never, never>;
```

> **One further `Functions` entry is present in the local database as of the
> final run: `create_order_atomic(p_user_id uuid, p_cart_id uuid, p_shipping
> jsonb) => jsonb`.** It was applied to the *shared local stack* by A2 while this
> branch was being written, and has no migration behind it yet. It is A2's, not
> mine — it shows up in `supabase gen types --local` but in no migration in this
> branch, so a `db:reset` from these migrations will not recreate it. A2 should
> land it as a migration; when they do, this diff should be applied for **both**
> functions in one edit.

**How A2 calls it.** Returns `1` when the stock was taken, `0` when there was
not enough. `0` also covers "no such product", so distinguish the two with the
catalogue read A2 already performs in the same transaction:

```ts
const { data: affected, error } = await admin.rpc('decrement_inventory', {
  p_product_id: productId,
  p_quantity: quantity,
});
if (affected === 0) {
  // insufficient stock for `productId`; `available` is from the read above
}
```

A non-positive `p_quantity` raises `22023` rather than adding stock.

**If A2 wants the whole checkout in one statement** — order, items, cart close
and inventory in a single transaction, as PLAN §5 A2 describes — that needs a
`create_order` function, and it is a request like this one, not a migration I
can write speculatively. The single primitive above is enough to build it out of
if you would rather compose it from the Edge Function.

---

## 2. `carts` / `orders` `Relationships` — the `UserFk` entry cannot be generated

**Who else depends on it:** nobody at runtime. `Relationships` is metadata
`supabase-js` uses to type embedded selects; no Kanso query embeds a parent
across the `auth` boundary, because `auth` is not an exposed schema.

The hand-written file declares, for `carts` and `orders`:

```ts
Relationships: [UserFk]; // { foreignKeyName: 'profiles_id_fkey', columns: ['user_id'],
//                         referencedRelation: 'users', referencedColumns: ['id'] }
```

`supabase gen types` emits `Relationships: []` for both. The foreign keys exist
in the database — `carts_user_id_fkey` and `orders_user_id_fkey`, both
`references auth.users (id) on delete cascade` — but the generator only emits a
relationship whose target is inside the schema set it is generating, and `auth`
is not in it. Verified with both `supabase gen types typescript --local` and
`--schema public`: identical result.

There is also a small inconsistency in the hand-written entry itself: it names
the constraint `profiles_id_fkey` for two tables that do not have that
constraint.

**The exact change**, if you want the file to match what regeneration produces:

```diff
-        Relationships: [UserFk];
+        Relationships: [];
```

(×2 — `carts` and `orders`.)

**Recommendation: leave it.** It is inert, and removing it buys nothing but a
cleaner diff against a future regeneration. Recorded here so that whoever runs
`gen types` next does not read it as a schema problem and go looking for a
missing foreign key.

---

## 3. `Insert` marks nullable columns optional

**Who else depends on it:** everyone who inserts. This is a widening, so nothing
breaks — but it is a visible diff and worth stating.

The hand-written `Insert` requires every key, including the nullable ones:

```ts
Insert: Omit<ProductRow, 'id' | 'created_at' | 'updated_at'>; // description: string | null — required
```

`supabase gen types` emits `description?: string | null` — optional *and*
nullable. It affects `products` (`spec_line`, `description`, `image_path`),
`profiles` (`email`, `full_name`, `avatar_url`, `phone`), `carts` (`closed_at`,
already optional in the hand-written file) and `orders` (`address_line2`).

No migration can change this: a column cannot be "required but nullable" in
generated output. The direction is safe — the database is strictly *more*
permissive than the contract, so every line written against the hand-written
file still compiles against the regenerated one. The two-way check confirmed it:
`contract → generated` passes everywhere, `generated → contract` fails only on
these.

**The exact change**, if you want the file to match regeneration:

```diff
-  Insert: Omit<ProductRow, 'id' | 'created_at' | 'updated_at'> & { … };
+  Insert: Omit<ProductRow, 'id' | 'created_at' | 'updated_at' | 'spec_line'
+            | 'description' | 'image_path'>
+          & { spec_line?: string | null; description?: string | null; image_path?: string | null }
+          & { id?: string; created_at?: string; updated_at?: string };
```

**Recommendation: leave it.** It is the generator's convention, the hand-written
shape is stricter and therefore safe, and changing it would touch five agents'
insert calls for no behavioural gain.

---

## 4. Generated types carry an extra `graphql_public` schema key

Cosmetic. `supabase gen types typescript --local` includes every schema in
`api.schemas` in `supabase/config.toml`, which lists `graphql_public` alongside
`public`. That schema is empty. The hand-written `Database` has only `public`.
Nothing to do unless you regenerate the file wholesale — at which point this
entry is already satisfied.

---

## 5. `eval "$(supabase status -o env)"` does not export — local test runs silently skip

**Who else depends on it:** every agent running `npm run test:func` locally, and
A8's README.

With the Supabase CLI 2.119 on this machine, `supabase status -o env` prints
bare assignments:

```
API_URL="http://127.0.0.1:54321"
PUBLISHABLE_KEY="sb_publishable_…"
```

— with no `export`. `eval` therefore sets *shell* variables, which the shell
itself can read but which are **not** passed to `npm run`'s child process. The
documented command in `docs/CONTRACTS.md` and in the docstring of
`tests/setup/functional.ts` consequently leaves the suite skipping itself:

```bash
eval "$(supabase status -o env)" && npm run test:func
# → Tests 1 passed | 28 skipped
```

It looks like a pass. Nothing is red; the assertions simply never ran.

**The exact change** to both places — one word, plus a `set -a`:

```diff
-eval "$(supabase status -o env)" && npm run test:func
+set -a; eval "$(supabase status -o env)"; set +a; npm run test:func
```

CI is unaffected: PLAN §7 uses `supabase status -o env >> $GITHUB_ENV`, which is
a different mechanism and does export.

---

## 6. `products.image_path` is null in the seed, and the `product-images` bucket now exists

**For A3, who owns the images.** Two things to know rather than to change:

1. The `product-images` bucket is **already created**, public, 5 MiB, accepting
   `image/webp`, `image/jpeg` and `image/png`
   (`20261002090300_product_image_bucket.sql`). It did not exist and nobody else
   writes SQL, so it is in a migration. **Do not create it again** from
   `upload-images.ts`; just upload.
2. `products.image_path` is seeded as `null` for all ten products. The
   storefront renders from the committed `product-images/manifest.json`, not from
   this column — `docs/CONTRACTS.md` § *Why a manifest rather than Storage* says
   so explicitly, and `docs/DATA-MODEL.md` repeats it.

**If you want the column populated**, the convention I would suggest, matching
the manifest paths the contract already specifies, is the Storage object path
without the bucket name:

```
product-images/desk/steel-rule-4x3-640.webp
```

That is a one-line `update` against the service role, or a second seed — but it
is your call, and it is a contract-shaped value on a public-facing table, so it
belongs in a request rather than in my branch. Say the word and I will add it to
`supabase/seed.sql` with the paths you name.

Requests raised by downstream agents against the frozen contract surface in
[`CONTRACTS.md`](./CONTRACTS.md). Reviewed and applied once, centrally, during
integration. Nothing here blocks the agent that raised it — the work is already
done against what exists.

---

## 7. `create_order_atomic` — the Postgres function order creation needs

**Raised by:** A2 (`feat/create-order`) · **For:** A1 (data), who owns migrations

**What I am building.** `supabase/functions/create-order`, the only trusted
server-side business operation in V1. SPEC §Edge Functions requires that
creating the order, writing its items, closing the cart and decrementing stock
happen as one transaction, and AGENTS.md repeats it: "a failure leaves no
half-order — no order without items, no closed cart without an order, no
decremented inventory without an order."

**The exact change.** One new function, in the same migration that creates the
tables. No new columns, no new tables, no changes to any existing type.

```sql
-- Atomic order creation. The only mutating path into `orders`.
--
-- Returns a structured outcome rather than raising, so a customer-caused
-- failure never has to be recovered from an error string. Genuine faults still
-- raise, and a raise rolls the whole thing back.
create or replace function public.create_order_atomic(
  p_user_id    uuid,
  p_cart_id    uuid,
  p_shipping   jsonb
) returns jsonb
language plpgsql
security invoker          -- service_role bypasses RLS; nothing to escalate past
set search_path = public
as $$
declare
  v_cart      public.carts;
  v_line      record;
  v_order     public.orders;
  v_subtotal  bigint := 0;
  v_attempt   int;
  v_items     jsonb := '[]'::jsonb;
  v_item      jsonb;
begin
  ---------------------------------------------------------------------------
  -- 1. The cart must belong to this caller and still be open. `for update`
  --    serialises two concurrent checkouts of the same cart.
  ---------------------------------------------------------------------------
  select * into v_cart
    from public.carts
   where id = p_cart_id and user_id = p_user_id and status = 'active'
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'cart_not_active');
  end if;

  ---------------------------------------------------------------------------
  -- 2. Price every line from the current catalogue and check stock. Read-only,
  --    so an early `return` here rolls nothing back.
  ---------------------------------------------------------------------------
  for v_line in
    select ci.product_id, ci.quantity, p.slug, p.name, p.price_kobo, p.inventory
      from public.cart_items ci
      join public.products  p  on p.id = ci.product_id
     where ci.cart_id = p_cart_id
     order by ci.created_at, ci.id
  loop
    if v_line.quantity is null or v_line.quantity < 1 then
      return jsonb_build_object(
        'ok', false, 'code', 'invalid_quantity', 'productId', v_line.product_id);
    end if;

    if v_line.inventory < v_line.quantity then
      return jsonb_build_object(
        'ok', false, 'code', 'insufficient_inventory',
        'productId',   v_line.product_id,
        'productName', v_line.name,
        'slug',        v_line.slug,
        'requested',   v_line.quantity,
        'available',   v_line.inventory);
    end if;

    v_subtotal := v_subtotal + (v_line.price_kobo::bigint * v_line.quantity);
  end loop;

  if not exists (select 1 from public.cart_items where cart_id = p_cart_id) then
    return jsonb_build_object('ok', false, 'code', 'cart_empty');
  end if;

  ---------------------------------------------------------------------------
  -- 3. The order. `reference` is left to the column default A1 already
  --    defines (`KS-XXXX-XX` from a uuid); the loop exists only so that a
  --    collision on that unique index is retried inside the transaction
  --    instead of failing the checkout.
  ---------------------------------------------------------------------------
  for v_attempt in 1..5 loop
    begin
      insert into public.orders (
        user_id, status,
        email, phone, full_name,
        address_line1, address_line2, city, state, country,
        subtotal_kobo, total_kobo
      ) values (
        p_user_id, 'confirmed',
        p_shipping->>'email',
        p_shipping->>'phone',
        p_shipping->>'fullName',
        p_shipping->>'addressLine1',
        nullif(p_shipping->>'addressLine2', ''),
        p_shipping->>'city',
        p_shipping->>'state',
        coalesce(p_shipping->>'country', 'Nigeria'),
        v_subtotal, v_subtotal
      )
      returning * into v_order;
      exit;
    exception when unique_violation then
      if v_attempt = 5 then
        raise exception 'reference_collision after % attempts', v_attempt
          using errcode = 'P0001';
      end if;
    end;
  end loop;

  ---------------------------------------------------------------------------
  -- 4. Items, snapshotting the name and the unit price at purchase time.
  ---------------------------------------------------------------------------
  for v_line in
    select ci.quantity, p.id as product_id, p.name, p.price_kobo
      from public.cart_items ci
      join public.products  p  on p.id = ci.product_id
     where ci.cart_id = p_cart_id
     order by ci.created_at, ci.id
  loop
    v_item := jsonb_build_object(
      'product_id',      v_line.product_id,
      'product_name',    v_line.name,
      'quantity',        v_line.quantity,
      'unit_price_kobo', v_line.price_kobo);

    insert into public.order_items (
      order_id, product_id, product_name, quantity, unit_price_kobo
    ) values (
      v_order.id, v_line.product_id, v_line.name, v_line.quantity, v_line.price_kobo
    );

    v_items := v_items || v_item;
  end loop;

  ---------------------------------------------------------------------------
  -- 5. Close the cart and take the stock.
  --
  --    A1 already ships `public.decrement_inventory(p_product_id, p_quantity)`,
  --    which does the conditional update and returns the affected row count.
  --    Reusing it keeps the stock rule in one place: a zero return means
  --    another checkout won the race between step 2 and here, so raise and let
  --    the whole transaction roll back. A `return` at this point would commit
  --    steps 3 and 4 — a real order and its items — over stock that is gone.
  ---------------------------------------------------------------------------
  update public.carts
     set status = 'closed', closed_at = now(), updated_at = now()
   where id = p_cart_id;

  for v_line in
    select ci.product_id, ci.quantity
      from public.cart_items ci
     where ci.cart_id = p_cart_id
  loop
    if public.decrement_inventory(v_line.product_id, v_line.quantity) = 0 then
      raise exception 'inventory_race on %', v_line.product_id using errcode = 'P0001';
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'order', to_jsonb(v_order),
    'items', v_items);
end;
$$;

-- Server-side only. `anon` and `authenticated` must never be able to call this:
-- it takes `p_user_id` as a parameter, and granting it to a browser role would
-- hand every customer the ability to place an order against somebody else.
revoke execute on function public.create_order_atomic(uuid, uuid, jsonb) from public, anon, authenticated;
grant  execute on function public.create_order_atomic(uuid, uuid, jsonb) to service_role;
```

**Why the existing surface cannot do it.** PostgREST exposes one statement per
request; a `supabase-js` client cannot open a transaction across statements, and
there is no PostgREST batch endpoint that is atomic. SPEC's transaction
requirement is therefore only expressible as a Postgres function. Everything else
in the V1 write path (carts, profiles, images) is fine with RLS and plain
queries — this is the one place where "RLS is not enough" is true, because the
order must be written with a user id the *server* resolved from a JWT.

**What the Edge Function sends and expects.** Recorded here because a rename on
either side breaks checkout at integration time, not at build time:

| | |
| --- | --- |
| RPC name | `create_order_atomic` |
| Arguments | `p_user_id: uuid`, `p_cart_id: uuid`, `p_shipping: jsonb` |
| `p_shipping` keys | `fullName`, `email`, `phone`, `addressLine1`, `addressLine2` (may be absent or `""`), `city`, `state`, `country` — camelCase, the wire names from `src/schemas/checkout.ts` |
| Success | `{ "ok": true, "order": { …orders row… }, "items": [ { product_id, product_name, quantity, unit_price_kobo } ] }` |
| Rejection | `{ "ok": false, "code": "insufficient_inventory" \| "cart_not_active" \| "cart_empty" \| "invalid_quantity", …facts }` |
| Raised fault | `errcode = 'P0001'` with message `inventory_race …` or `reference_collision …` |

Every column the function touches was checked against A1's live migration once
it landed, and all of them exist: `carts(id, user_id, status, closed_at,
updated_at)`, `cart_items(cart_id, product_id, quantity, created_at, id)`,
`products(id, slug, name, price_kobo, inventory, updated_at)`,
`orders(reference, user_id, status, email, phone, full_name, address_line1,
address_line2, city, state, country, subtotal_kobo, total_kobo)` and
`order_items(order_id, product_id, product_name, quantity, unit_price_kobo)`.
It also depends on `public.decrement_inventory(uuid, integer)`, which A1
already ships and which the SQL above calls rather than reimplementing.

**Who else depends on it.** A5 (cart and checkout) depends on the response
shape — it renders `insufficient_inventory` and the confirmation copy. Nobody
else calls it; `service_role` is the only grantee.

**Assumptions I made, checked against A1's real migration once it landed.**
`orders.reference` has a unique index and a default — confirmed, and the SQL
above relies on both. `orders.status` accepts `'confirmed'` — confirmed.
`order_items` has no unique constraint that a repeated `product_id` would
violate, and does not need one: this function re-reads the cart rather than
trusting a caller's line list, and `cart_items` is unique on
`(cart_id, product_id)`, so a duplicate product cannot reach it. "One active
cart per user" comes from a partial unique index on `carts (user_id) where
status = 'active'`; this function does not depend on it, it only refuses a
second commit of the same cart.

**Status.** A1's migrations landed on the local stack while I was finishing,
so this has now been run **for real**, end to end, through the served Edge
Function — not only in a scratch database. What follows is what was observed.

**Against a throwaway database first**, with the SQL taken verbatim from this
document, to prove the transaction before trusting it with the shared stack:

| Case | Result |
| --- | --- |
| Normal checkout | `ok: true`, `total_kobo` 1 090 000 = 1 × 450 000 + 2 × 320 000 |
| After the commit | cart `closed` with a `closed_at`; stock 2 → 1 and 10 → 8; both items snapshot name and unit price |
| Same cart committed twice | `{ ok: false, code: "cart_not_active" }` |
| Someone else's cart | `{ ok: false, code: "cart_not_active" }` |
| 9 wanted of 1 in stock | `{ ok: false, code: "insufficient_inventory", slug, productName, requested, available }`, and orders, stock and cart status all unchanged |
| Empty cart | `{ ok: false, code: "cart_empty" }` |
| **Stock stolen between the read and the decrement** | raises `inventory_race`; afterwards **0 orders, 0 order items, cart still `active` and unclosed, stock back to 10** — the whole transaction rolled back |

That last row is why the failure path raises instead of returning. A PL/pgSQL
`return` does not undo earlier statements in the same transaction, so
returning an error after step 3 would commit a real order and its items over
stock that no longer exists.

**Then against A1's real migration**, with the function applied temporarily to
the shared local stack and removed again afterwards. Four real orders went
through the served function over HTTP with a real Supabase session, and one
real confirmation was delivered to Mailpit. Nothing about the schema had to
change: every column the function reads matches `src/lib/supabase.types.ts`
exactly. Two things I learned that are worth passing on:

- **`orders.reference` already has a default.** A1 defines it as
  `KS-` + 4 hex chars + `-` + 2 hex chars from `gen_random_uuid()`, with a
  unique constraint. The SQL above therefore leaves `reference` out of the
  insert and keeps the retry loop only for the `unique_violation` case.
- **`public.decrement_inventory(p_product_id, p_quantity)` already exists** and
  does exactly the conditional update and row-count check this function needs.
  The SQL above calls it rather than repeating the rule, so the stock invariant
  lives in one place.

One observation, not a request: **`carts.status` has no column default.** An
insert that omits it fails the NOT NULL constraint, so every writer has to pass
`'active'` explicitly. A5's cart creation and this function both do. A default
of `'active'` would be tidier, but it is A1's schema and nothing is broken by
the current shape, so I have changed nothing.

And one limit worth stating: **`subtotal_kobo` and `total_kobo` are `integer`**,
not `bigint`. The function accumulates in `bigint` and lets Postgres reject an
overflow, which for this catalogue means no real order can reach it — the most
expensive thing in the shop is ₦52,000. It is a ceiling, not a defect.

---

## 8. `allowImportingTsExtensions` in `tsconfig.app.json`

**Raised by:** A2 · **For:** Foundation (the frozen-file owner)

**Why the existing surface cannot do it.** Deno 2 requires an explicit file
extension on relative imports, so the Edge Function writes
`import { createOrderPayloadSchema } from '../../../src/schemas/checkout.ts'`.
TypeScript rejects a `.ts` extension unless `allowImportingTsExtensions` is on.
`noEmit` is already set, which is the only other precondition. The same friction
is why `src/lib/errors.ts` and `src/lib/money.ts` are restated inside the
function rather than imported: with the flag on, both would import directly and
those copies would go.

**Who else depends on it.** Nobody today. It only widens what is legal; it does
not change any existing file's meaning. Two other agents will want it: any
future Edge Function, and anyone who writes a script that has to run under Deno
and be unit-tested under Vitest.

**Cheaper alternative, if Foundation would rather not.** Nothing. I worked around
it with `.js` specifiers inside `supabase/functions/**` (which Deno resolves to
the `.ts` source and which TypeScript's bundler resolution also accepts), so
only the single import that crosses from `supabase/functions/` into `src/`
needs the flag. The workarounds are documented in place.

---

## 9. `createLogger` exported from `src/lib/logger.ts`

**Raised by:** A2 · **For:** Foundation

**What I am building.** Structured logging in the Edge Function, following
`docs/LOGGING.md` exactly.

**The exact change.** Export the existing factory, and guard the one Vite-ism in
the module so it loads outside a bundler:

```diff
-export function createLogger(base: LogFields, level: LogLevelGate): Logger {
+export function createLogger(
+  base: LogFields,
+  level: LogLevelGate,
+  sink: (level: LogLevel, line: string) => void = consoleSink,
+): Logger {

-  const importMeta = import.meta.env as Record<string, unknown> | undefined;
+  const importMeta = (import.meta as { env?: Record<string, unknown> }).env;
```

**Why the existing surface cannot do it.** `scrub()` is the redaction backstop
that keeps credentials out of the log stream, and the function must not ship a
second copy of it that can drift. The module is currently unloadable outside
Vite: it imports `'./errors'` without an extension (Deno cannot resolve that)
and reads `import.meta.env` (absent outside a bundler, and untyped in Deno's
`ImportMeta`).

**Who else depends on it.** A3 and A7, if either writes tooling that must run
under both runtimes. Nothing observable changes for the browser: the default
sink stays the console, so `logger.info(...)` writes exactly what it writes
today.

**What I did instead.** `supabase/functions/_shared/logger.ts` is a faithful port
of the same `scrub` and the same API, with the two fixes applied and a comment
pointing here. If this is applied, that file collapses to an import.

---

## 10. `max-w-<name>` resolves against `--spacing-<name>`, not the container scale

**Who I am:** A6 — account and auth, `feat/account-auth`.

**What I am building.** The Google sign-in surface and the OAuth callback's
recovery actions. Both want a control column narrower than the page.

**The exact change.** One of the following in `src/styles/tokens.css`:

```diff
   @theme inline {
+  /* Container scale, so `max-w-sm` is 24rem and not the 8px spacing token. */
+  --container-xs: 20rem;
+  --container-sm: 24rem;
+  --container-md: 28rem;
+  --container-lg: 32rem;
+  --container-xl: 36rem;
     --spacing-xs: var(--k-space-xs);
```

or, if the container scale is meant to stay implicit, rename the spacing aliases
so they cannot collide with the size names (`--spacing-2xs`, `--space-sm`, …) and
update the four `--spacing-*` aliases above accordingly.

**Why the existing surface cannot do it.** Tailwind v4 resolves `max-w-<name>`
against `--container-<name>` **and** against `--spacing-<name>`; whichever it
finds, it uses. `tokens.css` declares `--spacing-xs/sm/md/lg/xl`, so the size
names are shadowed by spacing. Measured in the running app against `main` as of
the integration-2 pass:

| Class | Resolves to | Should be |
| --- | --- | --- |
| `max-w-sm` | `8px` | `24rem` |
| `max-w-md` | `16px` | `28rem` |
| `max-w-xl` | `40px` | `36rem` |
| `max-w-lg` | `none` | `32rem` |
| `max-w-2xl` | `672px` | `672rem` ✓ (numeric names are unaffected) |

This is not the missing-spacing-scale defect that integration-2 closed —
`gap-sm` is `8px`, `gap-lg` is `24px` and `gap-xl` is `40px` now, all correct.
The size names are shadowed instead, and they were shadowed before that pass too.

`npm run check:classes` cannot see it: `max-w-sm` *does* generate a rule, just
with the wrong value. Neither can `tests/unit/styles/designTokens.test.ts`, which
reads the tokens rather than the compiled widths.

**Who else depends on it.** Anything that writes `max-w-<name>` rather than
`max-w-<number>`: `max-w-prose` (595.92px, correct, because `prose` is not a
spacing key) is the only named width currently behaving. A4, A5 and A6 have all
had to reach for `max-w-prose` or a numeric name as a result.

**What I did instead.** `max-w-[24rem]` in the two places I needed a measure,
with the reason in a comment at each. It is explicit and cannot drift, but it
is not a token, and this should be fixed at the source.

---

## 11. `AuthCallbackPage` honours the checkout return — RESOLVED on `feat/account-auth`

**Who asked:** A5, in [`CART-CHECKOUT.md`](./CART-CHECKOUT.md) § 2. Open on
`main`.

**What was built.** `readDestination` in `src/features/auth/destination.ts` is the
reader A5's request asked for, in A5's order of preference:

1. `?returnTo=` from `location.search`, through `isSafeReturnTo`.
2. `consumeReturnTo()` — the one-shot `sessionStorage` marker — through the same
   check, which also removes the key.
3. `ROUTE_PATHS.account`.

`useAuthCallback` resolves it **once per distinct `search`** and holds the
answer, rather than in a `useMemo`. Reading the marker consumes it, and React
renders twice in development, so a memo would resolve once and discard the
answer — landing on `/account` instead of `/checkout`, in development only.

`GoogleSignInButton` writes both channels before it opens Google —
`rememberReturnTo(destination)` and `callbackUrlFor(destination)` — so the
account page's sign-in and checkout's sign-in behave identically.

`callbackMachine.parseAuthResponse` treats `returnTo` as a known parameter, so a
callback URL carrying one is not reported as `unexpected_parameter`.

Covered by `tests/unit/auth/authCallbackPage.test.tsx`: the parameter, the
stored marker, the parameter winning over the marker, the marker being cleared,
`//evil.example` refused, an off-origin URL refused, and the retry writing the
destination back out.

**A6's other note, for whoever reviews this.** `src/features/auth/destination.ts`
reads `ROUTE_PATHS.account` **inside** the function rather than at module scope.
`src/routes.ts` imports every page module and those import the components that
import this one, so a module-scope read evaluates while the cycle is still open
and yields `undefined` — a `TypeError` in every suite that imports a page. Worth
knowing before anyone adds another `ROUTE_PATHS` read at module scope.
