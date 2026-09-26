-- Fixes a cross-project data integrity gap found in a security audit:
-- createUnit() (src/lib/actions/units.ts) inserts building_id/floor_id
-- straight from client input, and units_write's RLS check only verifies
-- the caller owns the project named by project_id — it never confirms
-- building_id/floor_id actually belong to THAT project. A sub_admin
-- (deliberately, or via a client bug) could call createUnit with their own
-- project_id but a building_id/floor_id belonging to a DIFFERENT
-- sub_admin's building/floor tree, and it would succeed: a unit whose
-- project_id is theirs but whose building/floor references point into
-- someone else's data. buildings/floors don't have this exposure — each
-- only carries one parent reference, and RLS already validates that single
-- chain correctly.
--
-- A trigger rather than a CHECK constraint, since Postgres CHECK
-- constraints are per-row/self-contained expressions and can't join other
-- tables. Scoped to INSERT only (not UPDATE): updateUnit's input type
-- doesn't include building_id/floor_id at all (confirmed — only
-- createUnit can set them), so validating on UPDATE too would add zero
-- protection while risking a future retroactive failure on an ordinary
-- status/price edit if any pre-existing row were ever found inconsistent.
create function public.validate_unit_project_consistency()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  building_project uuid;
  floor_project uuid;
begin
  if new.building_id is not null then
    select project_id into building_project from public.buildings where id = new.building_id;
    if building_project is null then
      raise exception 'building_id % does not exist', new.building_id;
    end if;
    if building_project <> new.project_id then
      raise exception 'unit.project_id (%) does not match its building''s project (%)', new.project_id, building_project;
    end if;
  end if;

  if new.floor_id is not null then
    select b.project_id into floor_project
    from public.floors f join public.buildings b on b.id = f.building_id
    where f.id = new.floor_id;
    if floor_project is null then
      raise exception 'floor_id % does not exist', new.floor_id;
    end if;
    if floor_project <> new.project_id then
      raise exception 'unit.project_id (%) does not match its floor''s project (%)', new.project_id, floor_project;
    end if;
  end if;

  return new;
end;
$$;

create trigger validate_unit_project_consistency
  before insert on public.units
  for each row execute function public.validate_unit_project_consistency();
