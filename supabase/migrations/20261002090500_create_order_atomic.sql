-- Kanso — atomic order creation.
--
-- The only mutating path into `orders`, and the only place where "RLS is not
-- enough" is true. SPEC §Edge Functions and AGENTS.md both require that the
-- order, its items, the cart closure and the stock decrement happen as **one
-- transaction**, and a failure leaves no half-order: no order without items, no
-- closed cart without an order, no decremented inventory without an order.
--
-- Why a Postgres function. PostgREST exposes one statement per request, a
-- `supabase-js` client cannot open a transaction across statements, and there is
-- no batch endpoint that is atomic. Every other write in V1 — carts, profiles,
-- images — is fine with RLS and plain queries. The order write is different
-- because it has to be written with a user id the *server* resolved from a JWT,
-- which a row-level policy cannot express on behalf of an RPC.
--
-- security invoker, not definer: the function grants the caller nothing. It runs
-- as the service role, which already bypasses RLS, so there is nothing to
-- escalate past — and `security definer` on a function whose first argument is
-- `p_user_id` would be an escalation primitive if it were ever reachable by a
-- browser.
--
-- Returns a structured outcome rather than raising, so a *customer-caused*
-- failure never has to be recovered from an error string. Genuine faults still
-- raise, and a raise rolls the whole transaction back. That asymmetry is
-- deliberate and load-bearing: a PL/pgSQL `return` does not undo the statements
-- before it, so the post-write failures below must raise. Returning there would
-- commit a real order and its items over stock that no longer exists.
--
-- Deliberate deviation from the SQL in `docs/CONTRACT-REQUESTS.md` §7: the
-- `set search_path` is `''` rather than `public`, matching
-- `20261002090400_inventory_decrement.sql`. Every table and function this body
-- touches is schema-qualified, so nothing resolves differently; the empty search
-- path only removes the ability for a later edit to be captured by a shadowed
-- object. The SQL is otherwise verbatim.

create or replace function public.create_order_atomic(
  p_user_id    uuid,
  p_cart_id    uuid,
  p_shipping   jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = ''
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
  -- 3. The order. `reference` is left to the column default
  --    `20261002090000_core_schema.sql` already defines (`KS-XXXX-XX` from a
  --    uuid); the loop exists only so that a collision on that unique index is
  --    retried inside the transaction instead of failing the checkout.
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
  -- 4. Items, snapshotting the name and the unit price at purchase time. This
  --    is what makes a reprice tomorrow leave a historical order alone.
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
  --    `20261002090400_inventory_decrement.sql` already ships
  --    `public.decrement_inventory(p_product_id, p_quantity)`, which does the
  --    conditional update and returns the affected row count. Reusing it keeps
  --    the stock rule in one place. A zero return means another checkout won
  --    the race between step 2 and here, so raise and let the whole transaction
  --    roll back.
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

comment on function public.create_order_atomic(uuid, uuid, jsonb) is
  'Creates an order, its items, closes the cart and decrements stock in one transaction. Service role only: it takes p_user_id as a parameter, so a browser that could call it could place an order against somebody else.';

-- Server-side only. `anon` and `authenticated` must never be able to call this.
-- It performs order creation and inventory decrement, and it takes the user id
-- as a parameter rather than deriving it from a session — granting it to a
-- browser role would bypass RLS and hand every customer the ability to forge a
-- price and an owner.
revoke execute on function public.create_order_atomic(uuid, uuid, jsonb) from public, anon, authenticated;
grant  execute on function public.create_order_atomic(uuid, uuid, jsonb) to service_role;
