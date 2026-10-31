-- Checks for 20261028000100_validate_unit_links_on_update.sql (task 1.2).

-- 1. BEFORE APPLYING: existing units whose building or floor belongs to a
--    different project. Expect: no rows. Fix any rows here first.
select u.id, u.project_id, u.unit_number,
       b.project_id as building_project,
       fb.project_id as floor_project
from public.units u
left join public.buildings b on b.id = u.building_id
left join public.floors f on f.id = u.floor_id
left join public.buildings fb on fb.id = f.building_id
where (u.building_id is not null and b.project_id is distinct from u.project_id)
   or (u.floor_id is not null and fb.project_id is distinct from u.project_id);

-- 2. AFTER APPLYING: the trigger fires on both INSERT and UPDATE.
--    Expect two rows: INSERT and UPDATE.
select event_manipulation, action_timing
from information_schema.triggers
where event_object_schema = 'public'
  and event_object_table = 'units'
  and trigger_name = 'validate_unit_project_consistency'
order by event_manipulation;

-- 3. AFTER APPLYING: the UPDATE trigger is limited to the three link columns.
--    Expect: the definition contains
--    "BEFORE INSERT OR UPDATE OF project_id, building_id, floor_id ON public.units ...".
select pg_get_triggerdef(t.oid)
from pg_trigger t
where t.tgrelid = 'public.units'::regclass
  and t.tgname = 'validate_unit_project_consistency';

-- 4. TEST (runs inside a transaction and rolls back, so nothing is kept and
--    no cleanup is needed). Use a FLAT from YOUR test project (a plot must
--    have floor_id null, so it would fail a different check) and a floor
--    from a DIFFERENT test project. Expect: ERROR "unit.project_id (...)
--    does not match its floor's project (...)".
-- begin;
--   update public.units
--   set floor_id = '<floor id in another test project>'
--   where id = '<flat unit id in your test project>';
-- rollback;
--
--    Same for building_id (any unit type). Expect: ERROR "... does not match
--    its building's project (...)".
-- begin;
--   update public.units
--   set building_id = '<building id in another test project>'
--   where id = '<unit id in your test project>';
-- rollback;

-- 5. TEST: an ordinary edit still works (also rolled back).
--    Expect: UPDATE 1, no error.
-- begin;
--   update public.units set status = status where id = '<unit id in your test project>';
-- rollback;
