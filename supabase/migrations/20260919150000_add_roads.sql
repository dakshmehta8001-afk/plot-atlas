-- Roads: traced as an open polyline (not a closed polygon like a plot or
-- building footprint) along a road's centerline on the project's master
-- site-plan image, labeled with its width (e.g. "30 ft", "100 ft"). Shown
-- as a permanent label on the map (not behind a click), same idea as the
-- "25' Wide Road" labels seen on real site-plan graphics — except here the
-- sub-admin traces it once per project rather than needing it hand-drawn
-- into the plan image itself, so it works the same way for every project.
create table public.roads (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  width_label text not null,
  path_points jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index roads_project_id_idx on public.roads (project_id);

alter table public.roads enable row level security;

-- Same visibility rule as buildings/units: public once the project is
-- published, always visible to its owning sub-admin or an admin.
create policy roads_select on public.roads for select using (
  exists (
    select 1 from public.projects p where p.id = roads.project_id
    and (p.status = 'published' or p.sub_admin_id = auth.uid() or public.is_admin())
  )
);
create policy roads_write on public.roads for all using (
  exists (
    select 1 from public.projects p where p.id = roads.project_id
    and (p.sub_admin_id = auth.uid() or public.is_admin())
  )
) with check (
  exists (
    select 1 from public.projects p where p.id = roads.project_id
    and (p.sub_admin_id = auth.uid() or public.is_admin())
  )
);
