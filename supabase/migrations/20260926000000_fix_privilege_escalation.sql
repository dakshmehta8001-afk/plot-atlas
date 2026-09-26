-- Fixes two privilege-escalation paths found in a security audit, both
-- letting a non-admin end up with role='admin' and status='active':
--
-- (a) handle_new_user() trusted raw_user_meta_data->>'role' for ANY value.
--     signUpSubAdmin() (src/lib/actions/auth.ts) always hardcodes
--     role: 'sub_admin' server-side, so the app's own signup form was never
--     the problem — but Supabase's anon key is public by design, so nothing
--     stopped a direct supabase.auth.signUp() call (bypassing this app's UI
--     entirely) from passing options.data = { role: 'admin' }. The trigger
--     then inserted role='admin', and its status logic only held
--     role='sub_admin' to 'pending' — anything else, including 'admin', got
--     status='active' immediately. A brand-new admin account, zero existing
--     access needed.
-- (b) users_update_self had a USING clause but no WITH CHECK. Postgres
--     reuses USING as the check when WITH CHECK is omitted, so the only
--     enforced condition was "you're updating your own row" — nothing
--     constrained which COLUMNS changed. Any signed-in user (a viewer, or a
--     still-pending sub_admin) could run
--     supabase.from('users').update({ role: 'admin', status: 'active' })
--     .eq('id', session.user.id) directly from the browser and succeed.
--
-- Fix for (a): never derive role from client input beyond the one explicit
-- sub_admin signup flag. Admin accounts are only ever created by an
-- existing admin promoting a row directly (SQL), never via signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  assigned_role text := case
    when new.raw_user_meta_data->>'role' = 'sub_admin' then 'sub_admin'
    else 'viewer'
  end;
begin
  insert into public.users (id, email, name, role, status)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'name',
    assigned_role,
    case when assigned_role = 'sub_admin' then 'pending' else 'active' end
  );
  return new;
end;
$$;

-- Fix for (b): a BEFORE UPDATE trigger, not a WITH CHECK tweak — a trigger
-- gets unambiguous OLD/NEW row references (no snapshot-timing subtlety to
-- reason about) and applies no matter which policy let the UPDATE through,
-- so it stays correct even if a future policy change reintroduces a gap.
-- Unless the CALLING session is an admin (is_admin() — already
-- SECURITY DEFINER, safe from RLS recursion, existing function), role and
-- status are silently forced back to their current stored values: a
-- non-admin's attempt to change them is neutralized rather than erroring
-- out, so an update that ALSO legitimately changes some other column (e.g.
-- a future "edit my name" self-service feature) still succeeds, just
-- without the role/status part taking effect. An admin's own writes (e.g.
-- setSubAdminStatus in src/lib/actions/admin.ts, approving/rejecting a
-- sub-admin) are unaffected, since is_admin() checks the CALLING user
-- (auth.uid()), not which row is being written to.
--
-- The `auth.uid() is not null` guard matters: this project's own documented
-- workflow for promoting the FIRST admin account is a direct SQL statement
-- (`update public.users set role='admin' ...`) run via a service/superuser
-- connection (e.g. `supabase db query --linked`), which carries no JWT at
-- all — auth.uid() is null there, not some other user's id. Triggers fire
-- for every role, including superuser, regardless of RLS bypass, so without
-- this guard the trigger would silently undo that exact promotion. This
-- stays safe: `users_update_self`/`users_update_admin` only ever let an
-- UPDATE reach a row in the first place when auth.uid() is a real,
-- non-null id matching one of their conditions, so an actual end-user
-- client request (through PostgREST, anon or authenticated) can never
-- reach this trigger WITH a null auth.uid() — only a trusted direct/
-- service connection can, and that access level can bypass RLS/disable
-- this trigger outright anyway, so exempting it here doesn't weaken
-- anything a client could ever reach.
create function public.prevent_self_role_escalation()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.role := old.role;
    new.status := old.status;
  end if;
  return new;
end;
$$;

create trigger prevent_role_escalation
  before update on public.users
  for each row execute function public.prevent_self_role_escalation();
