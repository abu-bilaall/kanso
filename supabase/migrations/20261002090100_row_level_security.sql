-- Kanso — grants and row level security.
--
-- Two separate jobs, kept in one file because they are the same statement:
-- which role may attempt which *operation* (grants), and on which *rows*
-- (policies). A grant without a policy is a privilege nobody can use; a policy
-- without a grant is a rule nobody can reach. Every table below has both.
--
-- The rules, in full:
--
--   products    everyone may read. Nobody but the service role may write.
--   profiles    the owner may read and update their own row. Insert is the
--               signup trigger's job and nothing else.
--   carts       the owner may read, create, update and delete their own cart.
--   cart_items  the owner of the parent cart may do all four. Ownership is
--               one join away and that join is the whole policy.
--   orders      the owner may read. Nobody but the service role may write.
--   order_items the owner of the parent order may read. Nothing else.
--
-- There is no policy anywhere in this file that a role can use to reach another
-- user's rows, and none that bypasses row filtering for any role including
-- `service_role`. The service role bypasses RLS because Postgres grants it
-- BYPASSRLS, which is a property of the role, not something these policies
-- hand out.

-- ---------------------------------------------------------------------------
-- RLS on. With RLS enabled and no matching policy, a read returns no rows, an
-- update or delete affects no rows (RLS hides the row, so PostgREST reports
-- success with nothing changed), and an insert is refused with
-- "new row violates row-level security policy". All three are correct answers
-- to "you may not do this".
-- ---------------------------------------------------------------------------

alter table public.products enable row level security;
alter table public.profiles enable row level security;
alter table public.carts enable row level security;
alter table public.cart_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

-- ---------------------------------------------------------------------------
-- Grants — the operation, before the row.
--
-- These statements are a *declaration of intent*, not a restriction: a Supabase
-- project exposes new public tables to the Data API roles by default
-- (`auto_expose_new_tables`), so `anon` and `authenticated` already hold every
-- table privilege here before these lines run. RLS, not the grant, is what
-- denies. Writing the grants out anyway keeps the intended privilege set
-- visible in the repository, and keeps working if that default is ever turned
-- off.
--
-- Least privilege per role: the browser-facing role is `authenticated`, and
-- `anon` needs the catalogue and nothing else.
-- ---------------------------------------------------------------------------

grant select on public.products to anon, authenticated;

-- No insert grant: the profile row is created by the trigger as a definer, and
-- `id` is not the browser's to choose anyway.
grant select, update on public.profiles to authenticated;

grant select, insert, update, delete on public.carts to authenticated;
grant select, insert, update, delete on public.cart_items to authenticated;

-- Read-only on purpose. An order is created by the `create-order` Edge Function
-- as the service role, in one transaction, with prices it read from Postgres.
grant select on public.orders, public.order_items to authenticated;

grant all on
  public.products,
  public.profiles,
  public.carts,
  public.cart_items,
  public.orders,
  public.order_items
  to service_role;

-- ---------------------------------------------------------------------------
-- products — public read, service-role write
-- ---------------------------------------------------------------------------

create policy products_read_public
  on public.products
  for select
  to anon, authenticated
  using (true);

-- There is deliberately no insert, update or delete policy on products. With
-- RLS enabled, a policy that does not exist is a policy that denies, so
-- catalogue mutation is unavailable to `anon` and `authenticated` alike. The
-- only writer is the service role.

-- ---------------------------------------------------------------------------
-- profiles — your own row
--
-- `auth.uid()` is wrapped in a scalar subquery so Postgres evaluates it once as
-- an InitPlan rather than per row.
-- ---------------------------------------------------------------------------

create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using (id = (select auth.uid()));

create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- No insert policy. A user cannot invent a profile, and cannot take one over.
-- The `with check` above restates the `using` on purpose. It is not doing the
-- work on its own — when an UPDATE policy has no WITH CHECK, Postgres reuses
-- the USING expression for the new row too, verified on 9.x/17 — but an
-- explicit clause means nobody has to know that to be sure a row cannot be
-- rewritten onto somebody else's id.

-- ---------------------------------------------------------------------------
-- carts — your own cart
-- ---------------------------------------------------------------------------

create policy carts_select_own
  on public.carts
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy carts_insert_own
  on public.carts
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy carts_update_own
  on public.carts
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Same shape as the profiles update policy, and for the same reason: the
-- `with check` restates the `using` so a cart cannot be handed to another user
-- by rewriting `user_id`.

create policy carts_delete_own
  on public.carts
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- cart_items — ownership resolved through the parent cart
--
-- The join is the policy. `carts` is itself RLS-protected, so the sub-select
-- only ever sees the caller's own carts: even a cart belonging to somebody else
-- is invisible here, and the item is unreadable rather than merely unmodifiable.
-- ---------------------------------------------------------------------------

create policy cart_items_select_own
  on public.cart_items
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.carts c
      where c.id = cart_items.cart_id
        and c.user_id = (select auth.uid())
    )
  );

create policy cart_items_insert_own
  on public.cart_items
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.carts c
      where c.id = cart_items.cart_id
        and c.user_id = (select auth.uid())
    )
  );

create policy cart_items_update_own
  on public.cart_items
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.carts c
      where c.id = cart_items.cart_id
        and c.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.carts c
      where c.id = cart_items.cart_id
        and c.user_id = (select auth.uid())
    )
  );

create policy cart_items_delete_own
  on public.cart_items
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.carts c
      where c.id = cart_items.cart_id
        and c.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- orders — read your own, write nothing
-- ---------------------------------------------------------------------------

create policy orders_select_own
  on public.orders
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- No insert, update or delete policy: an order is created by `create-order` as
-- the service role, from a payload the browser cannot forge and prices the
-- browser cannot dictate.

-- ---------------------------------------------------------------------------
-- order_items — ownership resolved through the parent order
-- ---------------------------------------------------------------------------

create policy order_items_select_own
  on public.order_items
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.orders o
      where o.id = order_items.order_id
        and o.user_id = (select auth.uid())
    )
  );

-- No insert, update or delete policy, for the same reason as `orders`.
