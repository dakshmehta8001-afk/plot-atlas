-- Task 1.2: check a unit's building and floor links on UPDATE, not only on INSERT.
--
-- 20260926000100_validate_unit_project_consistency.sql added a trigger that
-- makes sure a unit's building_id and floor_id belong to the unit's own
-- project, but only "before insert". It skipped UPDATE because updateUnit()
-- (src/lib/actions/units.ts) never sends building_id or floor_id. That only
-- limits this app's own code: units_write lets the owner update their own
-- rows through PostgREST directly (the anon key is public), so a sub-admin
-- can run
--   update units set floor_id = '<someone else''s floor>' where id = '<my unit>'
-- and point their unit into another developer's building/floor tree.
--
-- The trigger now also fires on UPDATE, but only when the UPDATE names
-- project_id, building_id or floor_id ("update of"). An ordinary edit from
-- updateUnit() (status, price, size and so on) lists none of them, so it is
-- not checked and cannot start failing because of an older row. The check
-- function itself is unchanged.
--
-- Before applying, run check query 1 in
-- supabase/checks/20261028000100_validate_unit_links_on_update.check.sql: it
-- lists any existing units whose links already point at another project.
-- Those rows keep working for ordinary edits, but any update that names one
-- of the three columns would fail until the row is fixed.
drop trigger if exists validate_unit_project_consistency on public.units;

create trigger validate_unit_project_consistency
  before insert or update of project_id, building_id, floor_id on public.units
  for each row execute function public.validate_unit_project_consistency();
