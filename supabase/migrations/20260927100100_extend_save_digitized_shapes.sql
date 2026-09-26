-- Extends save_digitized_shapes (20260926000200_add_save_digitized_shapes_rpc.sql)
-- so a digitized plot's computed dimensions/area/category/review-flag
-- actually reach the database — before this, the digitize save path only
-- ever wrote unit_number/status/polygon_points for plots, so dimensions
-- was always NULL regardless of what the review UI computed or the
-- reviewer typed in. create or replace keeps the exact same function
-- signature (still SECURITY INVOKER, for the same reason the original
-- migration's comment explains: these are writes that must stay subject
-- to the same units_write RLS policy a direct .insert() goes through).
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
  insert into public.units (
    project_id, unit_type, unit_number, status, polygon_points,
    dimensions, area_sqft, category, needs_dimension_review
  )
  select
    p_project_id,
    'plot',
    elem->>'unit_number',
    coalesce(elem->>'status', 'available'),
    coalesce(elem->'polygon_points', '[]'::jsonb),
    elem->>'dimensions',
    nullif(elem->>'area_sqft', '')::numeric,
    elem->>'category',
    coalesce((elem->>'needs_dimension_review')::boolean, false)
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
