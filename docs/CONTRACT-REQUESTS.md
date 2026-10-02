# Contract requests

Requests raised by downstream agents against the frozen contract surface in
[`CONTRACTS.md`](./CONTRACTS.md). Reviewed and applied once, centrally, during
integration. Nothing here blocks the agent that raised it — the work is already
done against what exists.

---

## 1. `create_order_atomic` — the Postgres function order creation needs

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

## 2. `allowImportingTsExtensions` in `tsconfig.app.json`

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

## 3. `createLogger` exported from `src/lib/logger.ts`

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
