-- Kanso — the conditional inventory decrement.
--
-- Inventory is decremented by one statement that both subtracts and guards:
--
--   update products set inventory = inventory - $qty
--    where id = $id and inventory >= $qty;
--
-- If zero rows come back, the order is refused. The guard is evaluated while
-- Postgres holds the row lock, so two concurrent checkouts of the last unit
-- cannot both see stock and both decrement: one gets 1, the other gets 0.
--
-- Why a function and not a read followed by a write. The Data API can only
-- assign a *literal* to a column, so a REST call would have to send
-- `inventory = 4` computed from a value it read a moment earlier. Two requests
-- that both read 5 both send 4, both pass `inventory >= 1` (re-evaluated after
-- the first commits, when the row holds 4) and both succeed — inventory ends at
-- 4 instead of 3. The lost update is quieter than an oversell and just as
-- wrong. `inventory = inventory - $qty` has to be evaluated by the database, so
-- it has to live in the database.
--
-- This is the whole server-side inventory seam. `create-order` calls it once per
-- cart line, inside the transaction that writes the order, and treats 0 as
-- "insufficient stock" for that product.
--
-- SECURITY DEFINER, and execute revoked from anon and authenticated: the
-- browser cannot decrement stock, so a compromised client cannot manufacture
-- inventory. Only the service role — that is, the Edge Function — can call it.

create function public.decrement_inventory(p_product_id uuid, p_quantity integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected integer;
begin
  if p_quantity < 1 then
    -- Without this, a non-positive quantity satisfies `inventory >= p_quantity`
    -- and *adds* stock.
    raise exception 'decrement_inventory: quantity must be positive, got %', p_quantity
      using errcode = '22023';
  end if;

  update public.products
     set inventory = inventory - p_quantity
   where id = p_product_id
     and inventory >= p_quantity;

  get diagnostics affected = row_count;

  -- 1 when the stock was taken, 0 when there was not enough of it (or no such
  -- product). The caller distinguishes the two with the price and inventory read
  -- it performs in the same transaction, not by guessing here.
  return affected;
end;
$$;

comment on function public.decrement_inventory(uuid, integer) is
  'Atomically decrements stock, returning 1 if it succeeded and 0 if there was not enough. Service role only.';

revoke all on function public.decrement_inventory(uuid, integer) from public, anon, authenticated;
grant execute on function public.decrement_inventory(uuid, integer) to service_role;
