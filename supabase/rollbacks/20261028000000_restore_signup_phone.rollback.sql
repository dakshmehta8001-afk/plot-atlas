-- Rollback for 20261028000000_restore_signup_phone.sql (task 1.1).
--
-- Puts handle_new_user() back to the 2026-09-26 version (no phone column).
--
-- The phone backfill is NOT undone: it only filled phones that were NULL,
-- from what each user typed at signup, so there is no earlier value to
-- restore, and blanking real phone numbers would lose data. If you really
-- need it gone, the backfilled rows are the sub-admins whose phone equals
-- their auth.users raw_user_meta_data->>'phone'; review before clearing.
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
