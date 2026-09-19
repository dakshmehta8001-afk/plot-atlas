-- Site features: parks, temples, gates, clubhouses, common areas, water
-- bodies — the non-sellable amenities/landmarks a site plan often shows
-- alongside plots and roads. Traced as a closed polygon on the project's
-- master site-plan image, same coordinate contract as buildings/units
-- (fractional 0..1 polygon_points). Structurally mirrors the `roads` table
-- (see 20260919150000_add_roads.sql) — same RLS shape, just a different
-- payload — since nothing analogous existed to reuse.
create type public.site_feature_kind as enum (
  'park',
  'temple',
  'gate',
  'clubhouse',
  'common_area',
  'water_body',
  'other'
);

create table public.site_features (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kind public.site_feature_kind not null,
  label text not null,
  polygon_points jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index site_features_project_id_idx on public.site_features (project_id);

alter table public.site_features enable row level security;

-- Same visibility rule as buildings/units/roads: public once the project is
-- published, always visible to its owning sub-admin or an admin.
create policy site_features_select on public.site_features for select using (
  exists (
    select 1 from public.projects p where p.id = site_features.project_id
    and (p.status = 'published' or p.sub_admin_id = auth.uid() or public.is_admin())
  )
);
create policy site_features_write on public.site_features for all using (
  exists (
    select 1 from public.projects p where p.id = site_features.project_id
    and (p.sub_admin_id = auth.uid() or public.is_admin())
  )
) with check (
  exists (
    select 1 from public.projects p where p.id = site_features.project_id
    and (p.sub_admin_id = auth.uid() or public.is_admin())
  )
);
