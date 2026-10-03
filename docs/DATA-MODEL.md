# Kanso — the data model

> **Status: current guidance.** Accurately describes the six migrations in
> `supabase/migrations/**` as they stand on `main`. See
> [`docs/README.md`](./README.md) for the rest of the map.

Everything Kanso stores, why it is shaped that way, and what each caller is
allowed to do with it. Written so that you can write a query, an Edge Function or
a test against this document without opening a migration.

The authoritative source is `supabase/migrations/**`. This file explains it; it
does not replace it. When the two disagree, the migration is right and this file
is a bug.

- [The rules that shaped it](#the-rules-that-shaped-it)
- [Money](#money)
- [Enums](#enums)
- [products](#products)
- [profiles](#profiles)
- [carts](#carts)
- [cart_items](#cart_items)
- [orders](#orders)
- [order_items](#order_items)
- [Functions](#functions)
- [Who may do what](#who-may-do-what)
- [Inventory](#inventory)
- [Applying it](#applying-it)
- [Testing it](#testing-it)
- [Deliberate non-decisions](#deliberate-non-decisions)

---

## The rules that shaped it

1. **Postgres is the authority.** Prices, inventory, ownership and totals are
   read from the database at the moment they are used. Nothing the browser sends
   is believed, and nothing is cached in a column that a price change could
   invalidate.
2. **An order is durable; a cart is not.** The cart is working state and is
   closed when the order exists. Deleting a cart must never be able to lose a
   purchase.
3. **History is a snapshot.** What a customer was charged is stored on the order,
   not derived from the catalogue later.
4. **The database refuses bad data, not just the browser.** Every rule a Zod
   schema enforces in the browser is also a constraint here, so a client that
   skips validation gets an error instead of a corrupt row.
5. **RLS is the only thing standing between one customer and another's data.**
   A missing policy is a denial, not an oversight.

## Money

Integer **kobo**. 1 naira = 100 kobo. Every monetary column ends in `_kobo` and
is an `integer`; there is no `numeric`, no `double precision` and no currency
column, because Kanso sells in NGN only.

Money arrives from the catalogue and leaves on the order. In between, arithmetic
happens in exactly two places: the line total, which is
`order_items.quantity * order_items.unit_price_kobo`, and the order total, which
`create-order` sums server-side. The browser formats kobo for display and
nothing else — `src/lib/money.ts` is the only formatter.

`check (price_kobo >= 0)`, `check (unit_price_kobo >= 0)` and
`check (subtotal_kobo >= 0)` / `check (total_kobo >= 0)` make a negative amount
unrepresentable.

## Enums

Postgres enums, not text. A typo in a category is a compile error rather than a
row that renders as an empty chip.

| Enum | Values | Notes |
| --- | --- | --- |
| `product_category` | `desk`, `carry`, `write` | Declaration order is the storefront's display order. |
| `cart_status` | `active`, `closed` | The whole cart lifecycle in V1. |
| `order_status` | `pending`, `confirmed`, `cancelled` | V1 only ever writes `confirmed`. The other two exist so no downstream type has to widen later. |

---

## products

The catalogue. Publicly readable because the storefront is public; writable by
the service role only, because a price is a business decision and stock is a
fact about the warehouse.

| Column | Type | Null | Default | Why |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | no | `gen_random_uuid()` | Referenced by cart items and order items. Never exposed as a URL. |
| `slug` | `text` | no | — | **Unique.** The storefront's URL key: `/product/:slug`, and the key into `product-images/manifest.json`. Immutable once seeded. |
| `name` | `text` | no | — | Display name. |
| `category` | `product_category` | no | — | The catalogue filter. Filtered in SQL, never in JS. |
| `spec_line` | `text` | yes | — | The short technical line under the name, e.g. `18oz dry-waxed canvas / 13"`. |
| `description` | `text` | yes | — | Long copy. Null until there is something worth saying. |
| `price_kobo` | `integer` | no | — | Integer kobo, `>= 0`. The browser formats it; it never computes it. |
| `inventory` | `integer` | no | — | Units available, `>= 0`. **No default**: nothing creates a product without stating its stock, and a product silently created at zero reads as "sold out" everywhere. |
| `image_path` | `text` | yes | — | Storage object path or public URL, recorded for the record. Null in the seed — the media agent owns it. The storefront renders from the committed manifest, not from this column. |
| `created_at` | `timestamptz` | no | `now()` | Also the catalogue's default sort key. |
| `updated_at` | `timestamptz` | no | `now()` | Maintained by the `products_set_updated_at` trigger. |

**No `is_active` column.** A product that leaves the catalogue is deleted by the
service role, not hidden behind a flag. V1 has no soft delete and no archive.

**Indexes and constraints**

| Name | Kind | Covers |
| --- | --- | --- |
| `products_pkey` | primary key | `id` |
| `products_slug_key` | unique | `slug` — also the index behind every product lookup by URL. |

**Seed** — `supabase/seed.sql` writes the ten products of PLAN.md §2.4, four
Desk, three Carry, three Write, with `created_at` derived from the plan's own
ordering so the default sort groups the catalogue by division. Re-running it
converges on the plan, including inventory.

`technical-fountain-pen` at 4 and `canvas-messenger-bag` at 6 are deliberate: they
exercise the low-stock UI and give the inventory test a product that *can* be
oversold if the decrement is ever made non-conditional. Nothing is at 0. Do not
"fix" these numbers.

## profiles

One row per auth user, keyed by `auth.users.id`. Created by the
`handle_new_user` trigger; editable by its owner.

| Column | Type | Null | Default | Why |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | no | — | **Primary key and** `references auth.users (id) on delete cascade`. There is no surrogate key and no `user_id` column, so there is nothing to get out of sync. |
| `email` | `text` | yes | — | Copied from `auth.users` at signup. Nullable: an identity provider that does not release an address must not fail the signup. |
| `full_name` | `text` | yes | — | From `user_metadata.full_name`, falling back to `user_metadata.name`. |
| `avatar_url` | `text` | yes | — | From `user_metadata.avatar_url`, falling back to `user_metadata.picture`. |
| `phone` | `text` | yes | — | The one field the user edits. |
| `created_at` | `timestamptz` | no | `now()` | |
| `updated_at` | `timestamptz` | no | `now()` | Maintained by trigger. |

The profile is a convenience record, not a source of truth. Anything that
happened at a point in time — an order's address, a name typed at checkout — is
snapshotted on the order instead.

## carts

Working state. It is created lazily on first use, mutated freely, and closed when
an order exists.

| Column | Type | Null | Default | Why |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | no | `gen_random_uuid()` | |
| `user_id` | `uuid` | no | — | `references auth.users (id) on delete cascade`. **Every policy resolves ownership from this column**, never from a value in the request. |
| `status` | `cart_status` | no | — | No default: the code opening a cart states the lifecycle it is opening. |
| `closed_at` | `timestamptz` | yes | — | Set by `create-order` when the cart is closed. Null while active. |
| `created_at` / `updated_at` | `timestamptz` | no | `now()` | `updated_at` by trigger. |

**`carts_one_active_per_user_idx`** — a partial unique index on `(user_id) where
status = 'active'`. This is the whole of "a user has at most one active cart": a
full unique index on `user_id` would also forbid the closed carts a shopper
accumulates, and application-level checking races. The index doubles as the index
behind "my active cart", which is the query `useCart` runs on every page load.

A second active cart fails with `23505`. Closing the first frees the slot.

## cart_items

One row per product per cart.

| Column | Type | Null | Default | Why |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | no | `gen_random_uuid()` | |
| `cart_id` | `uuid` | no | — | `references public.carts (id) on delete cascade`. A deleted cart takes its lines with it. |
| `product_id` | `uuid` | no | — | `references public.products (id) on delete restrict`. A product an order points at cannot be deleted out from under it. |
| `quantity` | `integer` | no | — | `check (quantity > 0)`. Enforced here as well as in Zod. |
| `created_at` / `updated_at` | `timestamptz` | no | `now()` | `updated_at` by trigger. |

**`cart_items_cart_id_product_id_key`** — `unique (cart_id, product_id)`. A
product occurs at most once in a cart, so changing a quantity updates the row
rather than appending a second line. `useCart` depends on this name: it upserts
with `onConflict: 'cart_id,product_id'`. The index also serves every "items in
this cart" query, so there is no separate `cart_id` index.

**`quantity` has no zero.** `setItemQuantity(productId, 0)` must `delete` the
line, not update it to 0 — the check constraint will refuse the update.

There is no unit price here. A cart line is a wish; the price is whatever the
catalogue says when the order is created.

## orders

The durable purchase record. Written only by the `create-order` Edge Function as
the service role, in one transaction, from prices it read from Postgres.

| Column | Type | Null | Default | Why |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | no | `gen_random_uuid()` | The uuid a confirmation URL uses. |
| `reference` | `text` | no | inline expression | **Unique.** Human-facing, e.g. `KS-8902-DX`, shown in the UI and the email. Generated in the column default as an inline expression rather than by a function, so the public schema has no callable surface and `supabase gen types` reports `Functions: Record<never, never>` exactly as the contract declares. |
| `user_id` | `uuid` | no | — | `references auth.users (id) on delete cascade`. |
| `status` | `order_status` | no | — | No default. V1 writes `confirmed`. |
| `email` | `text` | no | — | Snapshot of the checkout address. Not read back from the profile. |
| `phone` | `text` | no | — | As above. |
| `full_name` | `text` | no | — | As above. |
| `address_line1` | `text` | no | — | As above. |
| `address_line2` | `text` | yes | — | The only optional fulfilment field. |
| `city` / `state` / `country` | `text` | no | — | As above. |
| `subtotal_kobo` | `integer` | no | — | Sum of the line snapshots, computed server-side. |
| `total_kobo` | `integer` | no | — | Equals `subtotal_kobo` in V1: there is no shipping charge. Both are stored so a future shipping rule does not have to reinterpret old orders. |
| `created_at` | `timestamptz` | no | `now()` | Newest-first ordering for the order history. |
| `updated_at` | `timestamptz` | no | `now()` | By trigger. |

**`orders_user_id_created_at_idx`** — `(user_id, created_at desc)`. Exactly the
query `useOrders` runs for the account page, and the query the "load more" case
would run.

**No `cart_id` column.** The cart is closed and forgotten. Keeping the link would
invite treating the cart as the purchase record, which is the mistake the whole
lifecycle is arranged to prevent.

## order_items

The snapshot. This is the table that makes a historical order independent of the
catalogue.

| Column | Type | Null | Default | Why |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | no | `gen_random_uuid()` | |
| `order_id` | `uuid` | no | — | `references public.orders (id) on delete cascade`. |
| `product_id` | `uuid` | no | — | `references public.products (id) on delete restrict`, so the reference stays honest. |
| `product_name` | `text` | no | — | Snapshot of the name at purchase time. A renamed product does not rewrite history. |
| `quantity` | `integer` | no | — | `check (quantity > 0)`. |
| `unit_price_kobo` | `integer` | no | — | **The price the customer was charged**, `>= 0`. Never recomputed from `products.price_kobo`. |
| `created_at` | `timestamptz` | no | `now()` | There is no `updated_at`: an order line is not edited after the fact. |

**`order_items_order_id_idx`** — `(order_id)`, for `useOrder`'s line query.

The line total is `quantity * unit_price_kobo`. The order total is the sum of the
lines. Both are arithmetic over stored integers; neither reads the catalogue.

---

## Functions

| Function | Returns | Callable by | What it is for |
| --- | --- | --- | --- |
| `public.decrement_inventory(p_product_id uuid, p_quantity integer)` | `integer` — 1 if stock was taken, 0 if there was not enough | `service_role` only; revoked from `anon` and `authenticated` | The one atomic inventory operation. See below. |
| `public.handle_new_user()` | trigger | trigger only; `execute` revoked | Creates the `profiles` row on signup. `SECURITY DEFINER`. |
| `public.set_updated_at()` | trigger | trigger only | Maintains `updated_at`. |

## Who may do what

Two layers, and the second one is what actually enforces. A **grant** says which
role may attempt an operation; a **policy** says on which rows. Supabase exposes
new public tables to the Data API roles by default, so the roles here hold every
table privilege whatever the grants below say — **RLS is the only thing denying
anything**. The grants are written out to document the intended privilege set
and to keep working if that default is ever switched off.

`anon` and `authenticated` are the browser-facing roles. `service_role` bypasses
RLS because Postgres makes it `BYPASSRLS` — a property of the role, not something
a policy hands out. No policy in this schema weakens or short-circuits that for
any other role.

The table below is therefore the *effective* capability, which is what the
policies produce, not what the grants nominally allow.

| Table | `anon` | `authenticated` | `service_role` |
| --- | --- | --- | --- |
| `products` | select all | select all | full |
| `profiles` | nothing | select + update **own row** | full |
| `carts` | nothing | select, insert, update, delete **own cart** | full |
| `cart_items` | nothing | select, insert, update, delete **own cart's lines** | full |
| `orders` | nothing | select **own** | full |
| `order_items` | nothing | select **own order's lines** | full |

**Policy names**, all in `supabase/migrations/20261002090100_row_level_security.sql`:

| Policy | Table | Command | Rule |
| --- | --- | --- | --- |
| `products_read_public` | products | select | `using (true)` for `anon, authenticated`. |
| `profiles_select_own` | profiles | select | `id = (select auth.uid())` |
| `profiles_update_own` | profiles | update | `using` and `with check` on `id = (select auth.uid())`, so a row cannot be rewritten onto another id. |
| `carts_select_own` | carts | select | `user_id = (select auth.uid())` |
| `carts_insert_own` | carts | insert | `with check (user_id = (select auth.uid()))` |
| `carts_update_own` | carts | update | `using` and `with check` on `user_id`, so a cart cannot be handed to another user by rewriting its owner. |
| `carts_delete_own` | carts | delete | `using (user_id = (select auth.uid()))` |
| `cart_items_select_own` | cart_items | select | `exists (select 1 from carts c where c.id = cart_items.cart_id and c.user_id = (select auth.uid()))` |
| `cart_items_insert_own` | cart_items | insert | same `exists`, as `with check` |
| `cart_items_update_own` | cart_items | update | same `exists`, as `using` **and** `with check` |
| `cart_items_delete_own` | cart_items | delete | same `exists`, as `using` |
| `orders_select_own` | orders | select | `user_id = (select auth.uid())` |
| `order_items_select_own` | order_items | select | `exists (select 1 from orders o where o.id = order_items.order_id and o.user_id = (select auth.uid()))` |

Three things to know when reading a denial, because they are easy to misdiagnose:

- **A cart item's owner is the owner of its cart, resolved by a join.** There is
  no `user_id` on `cart_items`, so the correlation `c.id = cart_items.cart_id`
  is the entire policy. A policy that checks "does this user own *any* cart"
  instead would let a shopper write into somebody else's cart, which is exactly
  the bug the functional suite is built to catch. The same shape applies to
  `order_items` and `orders`.
- **A refused UPDATE or DELETE is silent, not an error.** RLS hides the row, so
  PostgREST finds nothing to change and returns an empty result with a 200. Only
  a refused INSERT raises (`new row violates row-level security policy`), because
  there the row was in reach and only the `WITH CHECK` said no. Assert on the
  *effect* — did the row change — rather than on a status code.
- **An UPDATE policy's `with check` is usually a restatement, not extra work.**
  When a policy has a `using` and no `with check`, Postgres applies the `using`
  expression to the new row as well — verified on 17 — so omitting the clause
  from `profiles_update_own` or `carts_update_own` changes nothing. They are
  written out anyway, so that nobody editing a policy has to know that rule to
  be sure a row cannot change owner.

- **The SELECT policies are the primary gate; the write policies are the second
  layer.** An UPDATE or DELETE only reaches rows the caller can also read, so
  widening `carts_update_own` or `profiles_update_own` to `using (true)` on its
  own changes nothing observable — the row is already invisible through
  `carts_select_own` / `profiles_select_own`. That was measured, not assumed,
  while proving these tests: widening only the write policy left the suite
  green, and widening the matching read policy turned it red. Both sets of
  policies are written out because defence in depth is the whole point of RLS,
  but when you are debugging a denial, start at the SELECT policy.

`auth.uid()` is wrapped in a scalar subquery throughout so Postgres evaluates it
once as an InitPlan instead of once per row.

**A missing policy is a denial.** There is deliberately no insert, update or
delete policy on `products`, `orders` or `order_items`, and no insert policy on
`profiles`. With RLS enabled, an absent policy denies. Catalogue mutation and
order creation are service-role operations and nothing else.

## Inventory

Stock is authoritative in the database and is only ever moved by one statement:

```sql
update products set inventory = inventory - $qty
 where id = $id and inventory >= $qty;
```

Zero rows updated means insufficient stock. Postgres evaluates the guard while
holding the row lock, so of two concurrent checkouts racing for the last unit,
one gets 1 row updated and the other gets 0 — the loser is told to stop rather
than taking stock that is already sold.

That statement lives in `public.decrement_inventory` because **the Data API can
only assign a literal to a column**. A REST call would have to send
`inventory = 4` computed from a value it read a moment earlier; two requests that
both read 5 would both send 4, both pass `inventory >= 1` (re-evaluated after the
first commits, when the row holds 4) and both succeed, leaving 4 instead of 3.
The lost update is quieter than an oversell and just as wrong. The subtraction
has to be evaluated by the database, so it has to live in the database.

```
decrement_inventory(product_id, quantity) -> 1  stock was taken
                                          -> 0  not enough (or no such product)
```

`create-order` calls it once per cart line, inside the transaction that writes
the order, and treats 0 as "insufficient stock" for that product — naming the
product and the available count, which it knows from the catalogue read it did in
the same transaction. A non-positive quantity raises `22023` rather than adding
stock, and `check (inventory >= 0)` is the last line if anything else ever tries.

## Applying it

```bash
npm run db:start     # boot the shared local stack
npm run db:reset     # drop, migrate, seed — A1, Foundation and A7 only
npm run db:status    # connection values
```

Migrations, in order:
| `20261002090000_core_schema.sql` | Enums, tables, constraints, indexes, `updated_at` triggers, the order-reference default. |
| `20261002090100_row_level_security.sql` | RLS on every table, grants, and the thirteen policies. |
| `20261002090200_handle_new_user.sql` | The signup trigger. |
| `20261002090300_product_image_bucket.sql` | The public `product-images` bucket. |
| `20261002090400_inventory_decrement.sql` | The conditional decrement, callable only by the service role. |
| `20261002090500_create_order_atomic.sql` | Order, items, cart close and stock decrement in one transaction. Service role only. |

`supabase/seed.sql` runs after them on every reset. Both migrations and seed are
idempotent, so `db:reset` is always safe and always converges.

## Testing it

```bash
npm run test:func
```

> The runner behind that script finds the connection values itself — from the
> environment, or by parsing `supabase status -o env` — and refuses to start the
> suite if the stack is not answering. It does not skip. A run that verifies
> nothing must not report success, and an earlier version of this suite did
> exactly that whenever the values were missing.

`tests/functional/db/**` runs against the real stack with real JWTs: users are
created through the admin API with a unique email per run, fixtures are written
with the service role, and cleanup deletes only what the run created. Each test
that expects a refusal also asserts the *effect* — the row did not change — so a
policy that is too permissive fails even where the API stays quiet.

The suite was then broken on purpose, one rule at a time, to prove it is not
just asserting that a request happened. Thirteen breakages turned the relevant
test red: the `cart_items` and `order_items` ownership joins decoupled and
widened, `orders` and `carts` readable by anyone, the catalogue opened to
browser writes, the one-active-cart index dropped, the cart-item uniqueness
dropped, the positive-quantity check dropped, the inventory check dropped, the
conditional decrement replaced by an unconditional write, and the decrement
opened to signed-in browsers. Every one was restored, and the suite is green
again.

Two further breakages did **not** turn it red, and both are worth knowing:

- Dropping the `with check` clause from an UPDATE policy is a no-op in
  PostgreSQL — the `using` expression is applied to the new row anyway.
- Widening only an UPDATE policy to `using (true)` changed nothing observable,
  because the matching SELECT policy already hides those rows. Widening the
  SELECT policy instead — the same bug from the other side — does turn it red.

Both are recorded rather than papered over: the properties are still asserted,
and the note under *Who may do what* says where the real gate is.

## Deliberate non-decisions

Things a reviewer will reasonably ask about, and the answer:

- **No ORM, no query builder, no generated client.** Raw SQL, per PLAN §1. The
  only generated artefact is the type file, and it is frozen.
- **No `updated_at` on `order_items`.** An order line is not edited after the
  fact.
- **No `is_active` on `products`.** Delete it, do not hide it.
- **No soft delete anywhere.** Carts are disposable; orders are not disposable
  *and* there is no delete path to the browser at all.
- **No `currency` column.** One currency, enforced by the `_kobo` suffix.
- **No shipping, tax or discount columns on `orders`.** V1 has none. The email
  and the UI say so, and `total_kobo` equals `subtotal_kobo` honestly rather than
  hiding the fact in a formula.
- **No `create_order` function.** Writing the order transactionally is the Edge
  Function's call, and the contract request for it is in
  [`CONTRACT-REQUESTS.md`](./CONTRACT-REQUESTS.md). The one thing that *had* to
  move into the database — atomic inventory — is here.
