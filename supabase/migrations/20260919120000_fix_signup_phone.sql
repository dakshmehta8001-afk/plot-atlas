-- The sub-admin signup form (src/app/signup/page.tsx) collects a phone
-- number and the Server Action passes it through in raw_user_meta_data
-- (see signUpSubAdmin in lib/actions/auth.ts), but handle_new_user() never
-- read it back out — every sub-admin's phone landed as NULL in
-- public.users regardless of what they typed. Backfill existing rows from
-- the metadata that's still sitting on auth.users, then fix the trigger so
-- this doesn't keep happening.

update public.users u
set phone = a.raw_user_meta_data->>'phone'
from auth.users a
where a.id = u.id
  and u.phone is null
  and a.raw_user_meta_data->>'phone' is not null
  and a.raw_user_meta_data->>'phone' <> '';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, email, name, phone, role, status)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'name',
    new.raw_user_meta_data->>'phone',
    coalesce(new.raw_user_meta_data->>'role', 'viewer'),
    case when coalesce(new.raw_user_meta_data->>'role', 'viewer') = 'sub_admin'
         then 'pending' else 'active' end
  );
  return new;
end;
$$;
