-- Checks for 20261028000200_owner_writes_need_active_sub_admin.sql (task 1.3).

-- 1. The helper exists. Expect: one row.
select proname, prosecdef as security_definer
from pg_proc
where proname = 'is_active_sub_admin' and pronamespace = 'public'::regnamespace;

-- 2. Every owner write policy now checks is_active_sub_admin().
--    Expect: 16 rows, all with has_active_check = true.
select schemaname, tablename, policyname, cmd,
       (coalesce(qual, '') || coalesce(with_check, '')) ilike '%is_active_sub_admin%' as has_active_check
from pg_policies
where (schemaname = 'public' and policyname in (
        'projects_modify_owner', 'projects_delete_owner', 'buildings_write', 'floors_write',
        'units_write', 'project_media_write', 'roads_write', 'site_features_write',
        'leads_modify_owner', 'site_visits_all_owner'))
   or (schemaname = 'storage' and policyname in (
        'plan_images_owner_write', 'plan_images_owner_update', 'plan_images_owner_delete',
        'project_media_owner_write', 'project_media_owner_update', 'project_media_owner_delete'))
order by schemaname, tablename, policyname;

-- 3. Read policies are unchanged: none of them mention is_active_sub_admin.
--    Expect: 0.
select count(*) as read_policies_changed
from pg_policies
where cmd = 'SELECT' and coalesce(qual, '') ilike '%is_active_sub_admin%';

-- 4. For information: published projects whose owner is not an active
--    sub-admin. The new admin action drafts these when a sub-admin is
--    rejected from now on; projects of sub-admins rejected BEFORE this
--    change stay published until you draft them. Review, then run the
--    commented update if you want them offline.
select p.id, p.name, p.status, u.email, u.status as owner_status
from public.projects p
join public.users u on u.id = p.sub_admin_id
where p.status = 'published' and not (u.role = 'sub_admin' and u.status = 'active');
-- update public.projects p set status = 'draft'
-- from public.users u
-- where u.id = p.sub_admin_id and p.status = 'published'
--   and u.role = 'sub_admin' and u.status = 'rejected';

-- 5. TEST without the UI. Each block impersonates a test account inside a
--    transaction and rolls back, so nothing is kept.
--    Replace the ids with your TEST sub-admin's user id and a TEST project
--    they own.

-- 5a. Rejected sub-admin: edits change 0 rows.
--     (Set the test sub-admin to rejected first; see the manual test below.)
-- begin;
--   set local role authenticated;
--   select set_config('request.jwt.claims',
--     json_build_object('sub', '<test sub-admin user id>', 'role', 'authenticated')::text, true);
--   update public.projects set name = name where id = '<test project id>' returning id;  -- expect 0 rows
--   update public.units set status = status where project_id = '<test project id>' returning id;  -- expect 0 rows
-- rollback;

-- 5b. Active sub-admin: the same edits succeed (status back to active first).
-- begin;
--   set local role authenticated;
--   select set_config('request.jwt.claims',
--     json_build_object('sub', '<test sub-admin user id>', 'role', 'authenticated')::text, true);
--   update public.projects set name = name where id = '<test project id>' returning id;  -- expect 1 row
-- rollback;

-- 5c. Admin: still edits the rejected sub-admin's project.
-- begin;
--   set local role authenticated;
--   select set_config('request.jwt.claims',
--     json_build_object('sub', '<your admin user id>', 'role', 'authenticated')::text, true);
--   update public.projects set name = name where id = '<test project id>' returning id;  -- expect 1 row
-- rollback;

-- Manual test helpers for the test sub-admin only (run as the SQL editor /
-- service role, which this table's role trigger lets through):
-- update public.users set status = 'rejected' where id = '<test sub-admin user id>';
-- update public.users set status = 'active'   where id = '<test sub-admin user id>';

-- Cleanup after the manual test: delete the test sub-admin and everything they
-- own (projects cascade to buildings, floors, units, media rows, roads,
-- features and leads). Storage files are NOT removed by this; delete the
-- folder '<test sub-admin user id>/' in both buckets from the dashboard.
-- delete from public.projects where sub_admin_id = '<test sub-admin user id>';
-- delete from auth.users where id = '<test sub-admin user id>';
