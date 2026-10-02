-- Kanso — core schema.
--
-- Six tables, three enums, and the constraints that make the domain rules true
-- in the database rather than only in the browser:
--
--   products     the catalogue: price and inventory are authoritative here
--   profiles     one row per auth user, created by a trigger on signup
--   carts        at most one active cart per user
--   cart_items   a product appears at most once per cart, quantity always > 0
--   orders       the durable purchase record, with the checkout address
--   order_items  the purchase-time price snapshot, so history survives repricing
--
-- Money is **integer kobo** everywhere. There is no numeric, no double, and no
-- column whose name does not end in `_kobo` holds a monetary value.
--
-- Column names, nullability and defaults in this file are constrained by
-- `src/lib/supabase.types.ts`, which is a frozen contract other agents are
-- coding against. Do not rename a column or relax a `not null` without reading
-- `docs/DATA-MODEL.md` first.

-- ---------------------------------------------------------------------------
-- Enums
--
-- Declaration order is the storefront's display order, so `enum_range` is
-- already the right sort key.
-- ---------------------------------------------------------------------------

create type public.product_category as enum ('desk', 'carry', 'write');

create type public.cart_status as enum ('active', 'closed');

-- V1 only ever creates 'confirmed'. The other two exist so that no downstream
-- agent has to widen a type later.
create type public.order_status as enum ('pending', 'confirmed', 'cancelled');

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- products
--
-- The only table the storefront reads without a session. There is no `is_active`
-- column in V1: a product that leaves the catalogue is deleted by the service
-- role, not hidden behind a flag.
-- ---------------------------------------------------------------------------

create table public.products (
  id uuid primary key default gen_random_uuid(),
  -- The storefront's URL key. Immutable once seeded; it is in the manifest.
  slug text not null unique,
  name text not null,
  category public.product_category not null,
  -- The short technical line under the name, e.g. `18oz dry-waxed canvas / 13"`.
  spec_line text,
  description text,
  -- Integer kobo. The browser never computes a price; it formats this.
  price_kobo integer not null check (price_kobo >= 0),
  -- Units available. No default: nothing creates a product without stating its
  -- stock, and a product silently created at zero reads as "sold out".
  inventory integer not null check (inventory >= 0),
  -- Storage object path or public URL, recorded for the record. The storefront
  -- renders from `product-images/manifest.json`; the media agent owns this value.
  image_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.products is
  'Catalogue. Publicly readable, service-role writable. price_kobo and inventory are authoritative.';

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- profiles
--
-- One row per auth user. The primary key *is* the auth user id — there is no
-- surrogate key and no `user_id` column, so there is nothing to get out of
-- sync. Created by `handle_new_user`; the browser may only read and edit its
-- own row.
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'One row per auth user, keyed by auth.users.id. Written by the signup trigger and by its owner only.';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- carts
--
-- The cart is mutable working state, not a purchase record. `create-order`
-- closes it; the order is what survives.
-- ---------------------------------------------------------------------------

create table public.carts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- No default: the creating code states the lifecycle it is opening.
  status public.cart_status not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Set when the cart is closed by `create-order`. Null while active.
  closed_at timestamptz
);

comment on table public.carts is
  'Mutable working state. At most one active cart per user; the order is the durable record.';

-- A user has at most one active cart. A partial unique index is the only way to
-- say "at most one, but any number of closed ones".
create unique index carts_one_active_per_user_idx
  on public.carts (user_id)
  where status = 'active';

comment on index public.carts_one_active_per_user_idx is
  'Enforces one active cart per user, and doubles as the index for "my active cart" lookups.';

create trigger carts_set_updated_at
  before update on public.carts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- cart_items
-- ---------------------------------------------------------------------------

create table public.cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts (id) on delete cascade,
  -- Restrict: a catalogue entry that an order points at must not be deletable
  -- out from under the order. Order items snapshot name and price, so nothing
  -- is lost, but the reference is kept honest.
  product_id uuid not null references public.products (id) on delete restrict,
  -- Enforced here as well as in Zod: a client that skips validation gets an
  -- error from the database, not a corrupt cart.
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A product occurs at most once in a cart. Changing quantity updates this row;
  -- `useCart` relies on this for its upsert on (cart_id, product_id).
  constraint cart_items_cart_id_product_id_key unique (cart_id, product_id)
);

comment on table public.cart_items is
  'One row per product per cart. Ownership is resolved through the parent cart, not a user_id column.';

comment on constraint cart_items_cart_id_product_id_key on public.cart_items is
  'A product cannot appear twice in one cart. Also the index that serves every "items in this cart" query.';

create trigger cart_items_set_updated_at
  before update on public.cart_items
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------------

-- Human-facing reference, e.g. `KS-8902-DX`. Generated in the column default
-- so an order can never be inserted without one, and unique so the account page
-- can link to it unambiguously. It is an inline expression rather than a
-- function on purpose: the public schema then has no callable surface at all,
-- so `supabase gen types` reports `Functions: Record<never, never>` exactly as
-- `src/lib/supabase.types.ts` declares, and there is nothing for a browser
-- client to call.

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default (
    'KS-'
    || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4))
    || '-'
    || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 2))
  ),
  user_id uuid not null references auth.users (id) on delete cascade,
  status public.order_status not null,
  -- The checkout address, snapshotted like everything else on an order. It is
  -- never read back from the profile: the address a user gave at purchase time
  -- is the address the order shipped to.
  email text not null,
  phone text not null,
  full_name text not null,
  address_line1 text not null,
  address_line2 text,
  city text not null,
  state text not null,
  country text not null,
  -- Integer kobo, summed from the order item snapshots server-side. V1 has no
  -- shipping charge, so total_kobo equals subtotal_kobo; both are stored so a
  -- future shipping rule does not have to reinterpret old orders.
  subtotal_kobo integer not null check (subtotal_kobo >= 0),
  total_kobo integer not null check (total_kobo >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.orders is
  'The durable purchase record. Written only by the service role (create-order); readable only by its owner.';

-- The order history query: one user's orders, newest first.
create index orders_user_id_created_at_idx
  on public.orders (user_id, created_at desc);

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- order_items
--
-- The snapshot. `unit_price_kobo` and `product_name` are what the customer was
-- charged and what they bought; `products.price_kobo` may change tomorrow and
-- this row does not care.
-- ---------------------------------------------------------------------------

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete restrict,
  -- Snapshot of the product name at purchase time.
  product_name text not null,
  quantity integer not null check (quantity > 0),
  -- Snapshot of the unit price at purchase time, integer kobo.
  unit_price_kobo integer not null check (unit_price_kobo >= 0),
  created_at timestamptz not null default now()
);

comment on table public.order_items is
  'Purchase-time snapshot. Line total is quantity * unit_price_kobo, read from here and never recomputed from the catalogue.';

create index order_items_order_id_idx
  on public.order_items (order_id);
