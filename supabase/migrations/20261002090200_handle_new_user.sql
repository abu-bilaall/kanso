-- Kanso — profile creation on signup.
--
-- `auth.users` is the identity; `public.profiles` is the application record the
-- rest of the app reads. Nothing in the browser creates that row: there is no
-- insert policy on `profiles`, so the only writer is this trigger.
--
-- The function is SECURITY DEFINER because the role that inserts into
-- `auth.users` (GoTrue) has no business holding privileges on application
-- tables, and INVOKER would be denied by the very RLS policies above.
-- `set search_path = ''` means the function body resolves nothing from a
-- caller-controlled search path.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    -- Google sends `full_name`; some providers send only `name`. Prefer the
    -- richer one, accept either.
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name'
    ),
    coalesce(
      new.raw_user_meta_data ->> 'avatar_url',
      new.raw_user_meta_data ->> 'picture'
    )
  )
  -- A profile must never fail a signup. If the row is somehow already there —
  -- a re-import, a replayed event, a user created before this trigger existed —
  -- leave it alone and let the signup succeed.
  on conflict (id) do nothing;

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Creates public.profiles on auth.users insert. SECURITY DEFINER, conflict-safe, cannot fail a signup.';

-- A trigger function is only ever called by the trigger. Revoking execute keeps
-- it out of reach of a hand-written RPC call.
revoke execute on function public.handle_new_user() from public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
