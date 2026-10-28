-- Checks for 20261028000300_safer_leads.sql (task 1.4).

-- 1. BEFORE APPLYING: duplicate leads that would stop the unique index from
--    being created. Expect: no rows (there were 0 on 2026-10-28).
select viewer_id, unit_id, count(*) as copies, array_agg(id order by created_at) as lead_ids
from public.leads
where unit_id is not null
group by viewer_id, unit_id
having count(*) > 1;

-- 2. AFTER APPLYING: the insert policy checks the project and the unit.
--    Expect: true, true.
select with_check ilike '%status = ''published''%' as checks_published,
       with_check ilike '%u.project_id = leads.project_id%' as checks_unit_project
from pg_policies
where schemaname = 'public' and tablename = 'leads' and policyname = 'leads_insert_viewer';

-- 3. AFTER APPLYING: the trigger and the index exist. Expect: one row each.
select tgname from pg_trigger
where tgrelid = 'public.leads'::regclass and tgname = 'set_lead_contact_from_profile';
select indexname, indexdef from pg_indexes
where schemaname = 'public' and indexname = 'leads_one_per_viewer_unit';

-- 4. TESTS without the UI. Each block impersonates a TEST viewer inside a
--    transaction and rolls back, so nothing is kept. Replace the ids.
--    <viewer>         = a test viewer's user id
--    <pub project>    = a published test project
--    <draft project>  = an unpublished test project
--    <unit in pub>    = a unit of <pub project>
--    <unit elsewhere> = a unit of a different project

-- 4a. Faked contact details are replaced by the viewer's profile.
--     Expect: the returned name/email/phone are the viewer's own, not 'Fake'.
-- begin;
--   set local role authenticated;
--   select set_config('request.jwt.claims', json_build_object('sub', '<viewer>', 'role', 'authenticated')::text, true);
--   insert into public.leads (project_id, unit_id, viewer_id, name, email, phone)
--   values ('<pub project>', '<unit in pub>', '<viewer>', 'Fake', 'fake@example.com', '000')
--   returning name, email, phone;
-- rollback;

-- 4b. A draft project is refused. Expect: ERROR new row violates row-level security policy.
-- begin;
--   set local role authenticated;
--   select set_config('request.jwt.claims', json_build_object('sub', '<viewer>', 'role', 'authenticated')::text, true);
--   insert into public.leads (project_id, viewer_id, name) values ('<draft project>', '<viewer>', 'x');
-- rollback;

-- 4c. A unit from another project is refused. Expect: ERROR row-level security.
-- begin;
--   set local role authenticated;
--   select set_config('request.jwt.claims', json_build_object('sub', '<viewer>', 'role', 'authenticated')::text, true);
--   insert into public.leads (project_id, unit_id, viewer_id, name) values ('<pub project>', '<unit elsewhere>', '<viewer>', 'x');
-- rollback;

-- 4d. A second lead on the same unit is refused.
--     Expect: ERROR 23505 duplicate key value violates unique constraint "leads_one_per_viewer_unit".
-- begin;
--   set local role authenticated;
--   select set_config('request.jwt.claims', json_build_object('sub', '<viewer>', 'role', 'authenticated')::text, true);
--   insert into public.leads (project_id, unit_id, viewer_id, name) values ('<pub project>', '<unit in pub>', '<viewer>', 'x');
--   insert into public.leads (project_id, unit_id, viewer_id, name) values ('<pub project>', '<unit in pub>', '<viewer>', 'x');
-- rollback;

-- Cleanup after the manual UI test (the two enquiries made from the browser).
-- Run only for the test viewer.
-- delete from public.leads where viewer_id = '<viewer>';
