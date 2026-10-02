# Contract requests

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
