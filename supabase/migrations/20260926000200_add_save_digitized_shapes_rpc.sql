-- Fixes a data-integrity gap in the digitize feature's save path found in a
-- security audit: saveDigitizedShapes() (src/lib/actions/digitize.ts)
-- issued three separate .insert() calls (units, then roads, then
-- site_features) with no transaction wrapping them — if the first
-- succeeded and a later one failed, the action returned an error but the
-- earlier rows were already committed, and the review canvas's local state
-- (marked "not saved" from the error) would still hold those shapes,
-- risking duplicate rows if the sub-admin simply retried Save.
--
-- One security invoker function replaces the three separate insert calls,
-- doing all of them inside a single implicit transaction (a function call
-- IS one transaction) — a failure partway through rolls back everything,
-- not just the one insert that failed. SECURITY INVOKER (the default, but
-- named explicitly here) is deliberate, not an oversight: unlike
-- is_admin()/sub_admin_display_name() (SECURITY DEFINER, intentionally
-- bypassing RLS to avoid self-referential recursion on reads), this
-- function performs WRITES that must stay subject to the exact same
-- units_write/roads_write/site_features_write RLS policies a direct
-- .insert() call already goes through — running as the definer would
-- silently widen who can write, which is never the intent here.
create or replace function public.save_digitized_shapes(
  p_project_id uuid,
  p_plots jsonb default '[]'::jsonb,
  p_roads jsonb default '[]'::jsonb,
  p_features jsonb default '[]'::jsonb
)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  plot_count int;
  road_count int;
  feature_count int;
begin
  insert into public.units (project_id, unit_type, unit_number, status, polygon_points)
  select
    p_project_id,
    'plot',
    elem->>'unit_number',
    coalesce(elem->>'status', 'available'),
    coalesce(elem->'polygon_points', '[]'::jsonb)
  from jsonb_array_elements(p_plots) as elem;
  get diagnostics plot_count = row_count;

  insert into public.roads (project_id, width_label, path_points)
  select
    p_project_id,
    elem->>'width_label',
    coalesce(elem->'path_points', '[]'::jsonb)
  from jsonb_array_elements(p_roads) as elem;
  get diagnostics road_count = row_count;

  insert into public.site_features (project_id, kind, label, polygon_points)
  select
    p_project_id,
    coalesce(elem->>'kind', 'other')::public.site_feature_kind,
    elem->>'label',
    coalesce(elem->'polygon_points', '[]'::jsonb)
  from jsonb_array_elements(p_features) as elem;
  get diagnostics feature_count = row_count;

  return plot_count + road_count + feature_count;
end;
$$;

grant execute on function public.save_digitized_shapes(uuid, jsonb, jsonb, jsonb) to authenticated;
