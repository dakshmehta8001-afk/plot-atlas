-- Rollback for 20261028000100_validate_unit_links_on_update.sql (task 1.2).
-- Puts the trigger back to INSERT only, as created on 2026-09-26.
drop trigger if exists validate_unit_project_consistency on public.units;

create trigger validate_unit_project_consistency
  before insert on public.units
  for each row execute function public.validate_unit_project_consistency();
