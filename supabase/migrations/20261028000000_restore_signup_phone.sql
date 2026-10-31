-- Task 1.1: restore the sub-admin phone number on signup.
--
-- 20260926000000_fix_privilege_escalation.sql recreated handle_new_user() to
-- stop signups from choosing their own role, but the rewrite dropped the
-- phone column that 20260919120000_fix_signup_phone.sql had added. Since
-- then every new sub-admin lands in public.users with phone = NULL, even
-- though signUpSubAdmin() (src/lib/actions/auth.ts) still sends it in
-- raw_user_meta_data.
--
-- This keeps the 2026-09-26 role rule exactly as it is (role comes only from
-- the explicit 'sub_admin' flag, anything else is 'viewer'; status is
-- 'pending' for a sub-admin, 'active' otherwise) and adds phone back.
-- An empty or whitespace-only phone is stored as NULL, not ''.
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
  insert into public.users (id, email, name, phone, role, status)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'name',
    nullif(trim(new.raw_user_meta_data->>'phone'), ''),
    assigned_role,
    case when assigned_role = 'sub_admin' then 'pending' else 'active' end
  );
  return new;
end;
$$;

-- Backfill the users who signed up while the phone was being dropped, the
-- same way 20260919120000_fix_signup_phone.sql did: copy it from the
-- metadata still stored on auth.users, and never overwrite a phone that is
-- already set.
update public.users u
set phone = nullif(trim(a.raw_user_meta_data->>'phone'), '')
from auth.users a
where a.id = u.id
  and u.phone is null
  and nullif(trim(a.raw_user_meta_data->>'phone'), '') is not null;
