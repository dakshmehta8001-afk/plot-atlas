-- PlotAtlas initial schema
-- Roles: admin (platform-wide), sub_admin (developer/land owner, owns projects),
-- viewer (Google-auth end user who browses and enquires).
--
-- Data model: a project (development) contains land "plots" directly, and/or
-- "buildings" -> "floors" -> "flats". Plots and flats are both rows in the
-- single `units` table (unit_type discriminates), so status/category/RLS/
-- polygon-tracing logic is shared instead of duplicated across two tables.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text,
  phone text,
  role text not null default 'viewer' check (role in ('admin', 'sub_admin', 'viewer')),
  status text not null default 'active' check (status in ('pending', 'active', 'rejected')),
  created_at timestamptz not null default now()
);

-- New auth.users rows get a matching public.users row automatically.
-- Sub-admins sign up with role='sub_admin' in raw_user_meta_data and start
-- 'pending' until an admin approves them; everyone else (viewers, via Google
-- OAuth) is 'active' immediately.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, email, name, role, status)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'name',
    coalesce(new.raw_user_meta_data->>'role', 'viewer'),
    case when coalesce(new.raw_user_meta_data->>'role', 'viewer') = 'sub_admin'
         then 'pending' else 'active' end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Exposes only the display name publicly (never email/phone) for byline use
-- on public project pages, without needing a row-level public-read policy
-- on public.users itself.
create function public.sub_admin_display_name(sub_admin_id uuid)
returns text
language sql
security definer set search_path = public
stable
as $$
  select name from public.users where id = sub_admin_id;
$$;

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  sub_admin_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  slug text not null unique,
  location text,
  description text,
  developer_name text,
  plan_image_url text,
  map_bounds jsonb, -- {north, south, east, west} once satellite-aligned
  status text not null default 'draft' check (status in ('draft', 'published')),
  created_at timestamptz not null default now()
);

create index projects_sub_admin_id_idx on public.projects (sub_admin_id);

-- ---------------------------------------------------------------------------
-- buildings (traced as a footprint polygon on the project's plan image)
-- ---------------------------------------------------------------------------
create table public.buildings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  description text,
  total_floors int,
  polygon_points jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index buildings_project_id_idx on public.buildings (project_id);

-- ---------------------------------------------------------------------------
-- floors (each floor has its own plate layout image that flats are traced on)
-- ---------------------------------------------------------------------------
create table public.floors (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings(id) on delete cascade,
  floor_number int not null,
  name text,
  plan_image_url text,
  created_at timestamptz not null default now(),
  unique (building_id, floor_number)
);

create index floors_building_id_idx on public.floors (building_id);

-- ---------------------------------------------------------------------------
-- units: plots (project-level) and flats (floor-level) in one table
-- ---------------------------------------------------------------------------
create table public.units (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  building_id uuid references public.buildings(id) on delete cascade,
  floor_id uuid references public.floors(id) on delete cascade,
  unit_type text not null default 'plot' check (unit_type in ('plot', 'flat')),
  unit_number text not null,
  wing text,
  bhk_type text,
  category text,
  status text not null default 'available' check (status in ('available', 'hold', 'sold', 'booked')),
  facing text,
  dimensions text,
  area_sqft numeric,
  carpet_area_sqft numeric,
  rate_per_sqft numeric,
  total_price numeric,
  polygon_points jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint units_flat_needs_floor check (
    (unit_type = 'plot' and floor_id is null) or
    (unit_type = 'flat' and floor_id is not null)
  )
);

create index units_project_id_idx on public.units (project_id);
create index units_building_id_idx on public.units (building_id);
create index units_floor_id_idx on public.units (floor_id);

-- ---------------------------------------------------------------------------
-- project_media (gallery: images/videos shown in the Media panel)
-- ---------------------------------------------------------------------------
create table public.project_media (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  media_url text not null,
  media_type text not null default 'image' check (media_type in ('image', 'video')),
  caption text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index project_media_project_id_idx on public.project_media (project_id);

-- ---------------------------------------------------------------------------
-- leads (an "I'm interested" enquiry against a project or a specific unit)
-- ---------------------------------------------------------------------------
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  unit_id uuid references public.units(id) on delete set null,
  viewer_id uuid references public.users(id) on delete set null,
  name text not null,
  email text,
  phone text,
  message text,
  status text not null default 'new' check (status in ('new', 'contacted', 'visit_scheduled', 'converted', 'closed')),
  created_at timestamptz not null default now()
);

create index leads_project_id_idx on public.leads (project_id);
create index leads_unit_id_idx on public.leads (unit_id);
create index leads_viewer_id_idx on public.leads (viewer_id);

-- ---------------------------------------------------------------------------
-- site_visits (a sub-admin schedules/tracks a visit against a lead)
-- ---------------------------------------------------------------------------
create table public.site_visits (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  scheduled_at timestamptz,
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled', 'no_show')),
  notes text,
  created_at timestamptz not null default now()
);

create index site_visits_lead_id_idx on public.site_visits (lead_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.users enable row level security;
alter table public.projects enable row level security;
alter table public.buildings enable row level security;
alter table public.floors enable row level security;
alter table public.units enable row level security;
alter table public.project_media enable row level security;
alter table public.leads enable row level security;
alter table public.site_visits enable row level security;

-- users: everyone can read/update their own row; admins can read/update all.
create policy users_select_self on public.users for select using (auth.uid() = id);
create policy users_update_self on public.users for update using (auth.uid() = id);
create policy users_select_admin on public.users for select using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
);
create policy users_update_admin on public.users for update using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
);

-- projects: public can read published projects; sub_admin manages their own; admin manages all.
create policy projects_select_public on public.projects for select using (status = 'published');
create policy projects_select_owner on public.projects for select using (sub_admin_id = auth.uid());
create policy projects_select_admin on public.projects for select using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
);
create policy projects_insert_owner on public.projects for insert with check (
  sub_admin_id = auth.uid() and
  exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'sub_admin' and u.status = 'active')
);
create policy projects_modify_owner on public.projects for update using (sub_admin_id = auth.uid());
create policy projects_delete_owner on public.projects for delete using (sub_admin_id = auth.uid());
create policy projects_modify_admin on public.projects for update using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
);
create policy projects_delete_admin on public.projects for delete using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
);

-- buildings / floors / units / project_media: readable when the parent project
-- is publicly readable (published, or owned by the current sub_admin/admin);
-- writable only by the owning sub_admin or an admin.
create policy buildings_select on public.buildings for select using (
  exists (
    select 1 from public.projects p where p.id = buildings.project_id
    and (p.status = 'published' or p.sub_admin_id = auth.uid()
         or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'))
  )
);
create policy buildings_write on public.buildings for all using (
  exists (
    select 1 from public.projects p where p.id = buildings.project_id
    and (p.sub_admin_id = auth.uid()
         or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'))
  )
) with check (
  exists (
    select 1 from public.projects p where p.id = buildings.project_id
    and (p.sub_admin_id = auth.uid()
         or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'))
  )
);

create policy floors_select on public.floors for select using (
  exists (
    select 1 from public.buildings b join public.projects p on p.id = b.project_id
    where b.id = floors.building_id
    and (p.status = 'published' or p.sub_admin_id = auth.uid()
         or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'))
  )
);
create policy floors_write on public.floors for all using (
  exists (
    select 1 from public.buildings b join public.projects p on p.id = b.project_id
    where b.id = floors.building_id
    and (p.sub_admin_id = auth.uid()
         or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'))
  )
) with check (
  exists (
    select 1 from public.buildings b join public.projects p on p.id = b.project_id
    where b.id = floors.building_id
    and (p.sub_admin_id = auth.uid()
         or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'))
  )
);

create policy units_select on public.units for select using (
  exists (
    select 1 from public.projects p where p.id = units.project_id
    and (p.status = 'published' or p.sub_admin_id = auth.uid()
         or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'))
  )
);
create policy units_write on public.units for all using (
  exists (
    select 1 from public.projects p where p.id = units.project_id
    and (p.sub_admin_id = auth.uid()
         or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'))
  )
) with check (
  exists (
    select 1 from public.projects p where p.id = units.project_id
    and (p.sub_admin_id = auth.uid()
         or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'))
  )
);

create policy project_media_select on public.project_media for select using (
  exists (
    select 1 from public.projects p where p.id = project_media.project_id
    and (p.status = 'published' or p.sub_admin_id = auth.uid()
         or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'))
  )
);
create policy project_media_write on public.project_media for all using (
  exists (
    select 1 from public.projects p where p.id = project_media.project_id
    and (p.sub_admin_id = auth.uid()
         or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'))
  )
) with check (
  exists (
    select 1 from public.projects p where p.id = project_media.project_id
    and (p.sub_admin_id = auth.uid()
         or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'))
  )
);

-- leads: any signed-in viewer can create a lead for themselves; the owning
-- sub_admin and admins can read/manage leads against their own projects.
create policy leads_insert_viewer on public.leads for insert with check (viewer_id = auth.uid());
create policy leads_select_viewer on public.leads for select using (viewer_id = auth.uid());
create policy leads_select_owner on public.leads for select using (
  exists (select 1 from public.projects p where p.id = leads.project_id and p.sub_admin_id = auth.uid())
);
create policy leads_modify_owner on public.leads for update using (
  exists (select 1 from public.projects p where p.id = leads.project_id and p.sub_admin_id = auth.uid())
);
create policy leads_select_admin on public.leads for select using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
);
create policy leads_modify_admin on public.leads for update using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
);

-- site_visits: managed by the sub_admin who owns the lead's project, or an admin.
create policy site_visits_all_owner on public.site_visits for all using (
  exists (
    select 1 from public.leads l join public.projects p on p.id = l.project_id
    where l.id = site_visits.lead_id and p.sub_admin_id = auth.uid()
  )
) with check (
  exists (
    select 1 from public.leads l join public.projects p on p.id = l.project_id
    where l.id = site_visits.lead_id and p.sub_admin_id = auth.uid()
  )
);
create policy site_visits_all_admin on public.site_visits for all using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
) with check (
  exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
);

-- ---------------------------------------------------------------------------
-- storage: plan/floor images and gallery media, public read, folder-per-sub-admin write
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('plan-images', 'plan-images', true);
insert into storage.buckets (id, name, public) values ('project-media', 'project-media', true);

create policy plan_images_public_read on storage.objects for select using (bucket_id = 'plan-images');
create policy plan_images_owner_write on storage.objects for insert with check (
  bucket_id = 'plan-images' and (storage.foldername(name))[1] = auth.uid()::text
);
create policy plan_images_owner_update on storage.objects for update using (
  bucket_id = 'plan-images' and (storage.foldername(name))[1] = auth.uid()::text
);
create policy plan_images_owner_delete on storage.objects for delete using (
  bucket_id = 'plan-images' and (storage.foldername(name))[1] = auth.uid()::text
);

create policy project_media_public_read on storage.objects for select using (bucket_id = 'project-media');
create policy project_media_owner_write on storage.objects for insert with check (
  bucket_id = 'project-media' and (storage.foldername(name))[1] = auth.uid()::text
);
create policy project_media_owner_update on storage.objects for update using (
  bucket_id = 'project-media' and (storage.foldername(name))[1] = auth.uid()::text
);
create policy project_media_owner_delete on storage.objects for delete using (
  bucket_id = 'project-media' and (storage.foldername(name))[1] = auth.uid()::text
);
