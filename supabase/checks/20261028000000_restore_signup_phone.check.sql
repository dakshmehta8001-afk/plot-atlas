-- Checks for 20261028000000_restore_signup_phone.sql (task 1.1).
-- Read-only except the cleanup block at the end.

-- 1. The trigger function now writes phone. Expect: true.
select pg_get_functiondef('public.handle_new_user'::regproc) ilike '%phone%' as writes_phone;

-- 2. The role rule from 2026-09-26 is still in place: role comes only from the
--    'sub_admin' flag. Expect: true for both.
select
  pg_get_functiondef('public.handle_new_user'::regproc) ilike '%then ''sub_admin''%' as sub_admin_flag_only,
  pg_get_functiondef('public.handle_new_user'::regproc) ilike '%else ''viewer''%' as defaults_to_viewer;

-- 3. The backfill worked: no sub-admin still has a NULL phone while their
--    signup metadata holds one. Expect: 0.
select count(*) as missing_but_recoverable
from public.users u
join auth.users a on a.id = u.id
where u.role = 'sub_admin'
  and u.phone is null
  and nullif(trim(a.raw_user_meta_data->>'phone'), '') is not null;

-- 4. For information: sub-admins who still have no phone (they never gave one
--    at signup, so there is nothing to recover).
select u.email, u.status, u.created_at
from public.users u
where u.role = 'sub_admin' and u.phone is null
order by u.created_at;

-- 5. After the manual test (sign up a test sub-admin with a phone), the new
--    row has the phone, role sub_admin and status pending.
--    Replace the email with the test account's.
select email, phone, role, status
from public.users
where email = 'plotatlas-test-subadmin@example.com';

-- Cleanup for the manual test: delete the test sub-admin. Deleting from
-- auth.users cascades to public.users. Run only for the test account.
-- delete from auth.users where email = 'plotatlas-test-subadmin@example.com';
