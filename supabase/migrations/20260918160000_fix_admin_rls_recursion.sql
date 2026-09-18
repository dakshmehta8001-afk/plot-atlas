-- Fixes infinite RLS recursion discovered while seeding demo data: every
-- policy that checked "is the current user an admin" did so with
-- `exists (select 1 from public.users u where u.id = auth.uid() and
-- u.role = 'admin')` written inline. Evaluating that subquery against
-- `public.users` re-triggers `public.users`' own SELECT policies — and
-- `users_select_admin` used the exact same self-referential pattern on
-- itself, so checking "is this user an admin" required checking "is this
-- user an admin" required checking... forever. Postgres surfaces this as
-- `ERROR 42P17: infinite recursion detected in policy for relation "users"`,
-- and it broke every read on every table (not just users) whose policy
-- included an admin check, including the public projects listing.
--
-- Fix: a SECURITY DEFINER function's body runs as its owner (the
-- migration-running role, which has BYPASSRLS on a Supabase project), so a
-- query inside it does not re-trigger row_security on the tables it reads —
-- the same technique already used for sub_admin_display_name() in the
-- init_schema migration. Every policy that inlined the admin-exists check
-- is dropped and recreated here calling public.is_admin() instead.

create function public.is_admin()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (select 1 from public.users where id = auth.uid() and role = 'admin');
$$;

-- users
drop policy if exists users_select_admin on public.users;
create policy users_select_admin on public.users for select using (public.is_admin());

drop policy if exists users_update_admin on public.users;
create policy users_update_admin on public.users for update using (public.is_admin());

-- projects
drop policy if exists projects_select_admin on public.projects;
create policy projects_select_admin on public.projects for select using (public.is_admin());

drop policy if exists projects_modify_admin on public.projects;
create policy projects_modify_admin on public.projects for update using (public.is_admin());

drop policy if exists projects_delete_admin on public.projects;
create policy projects_delete_admin on public.projects for delete using (public.is_admin());

-- buildings
drop policy if exists buildings_select on public.buildings;
create policy buildings_select on public.buildings for select using (
  exists (
    select 1 from public.projects p where p.id = buildings.project_id
    and (p.status = 'published' or p.sub_admin_id = auth.uid() or public.is_admin())
  )
);
drop policy if exists buildings_write on public.buildings;
create policy buildings_write on public.buildings for all using (
  exists (
    select 1 from public.projects p where p.id = buildings.project_id
    and (p.sub_admin_id = auth.uid() or public.is_admin())
  )
) with check (
  exists (
    select 1 from public.projects p where p.id = buildings.project_id
    and (p.sub_admin_id = auth.uid() or public.is_admin())
  )
);

-- floors
drop policy if exists floors_select on public.floors;
create policy floors_select on public.floors for select using (
  exists (
    select 1 from public.buildings b join public.projects p on p.id = b.project_id
    where b.id = floors.building_id
    and (p.status = 'published' or p.sub_admin_id = auth.uid() or public.is_admin())
  )
);
drop policy if exists floors_write on public.floors;
create policy floors_write on public.floors for all using (
  exists (
    select 1 from public.buildings b join public.projects p on p.id = b.project_id
    where b.id = floors.building_id
    and (p.sub_admin_id = auth.uid() or public.is_admin())
  )
) with check (
  exists (
    select 1 from public.buildings b join public.projects p on p.id = b.project_id
    where b.id = floors.building_id
    and (p.sub_admin_id = auth.uid() or public.is_admin())
  )
);

-- units
drop policy if exists units_select on public.units;
create policy units_select on public.units for select using (
  exists (
    select 1 from public.projects p where p.id = units.project_id
    and (p.status = 'published' or p.sub_admin_id = auth.uid() or public.is_admin())
  )
);
drop policy if exists units_write on public.units;
create policy units_write on public.units for all using (
  exists (
    select 1 from public.projects p where p.id = units.project_id
    and (p.sub_admin_id = auth.uid() or public.is_admin())
  )
) with check (
  exists (
    select 1 from public.projects p where p.id = units.project_id
    and (p.sub_admin_id = auth.uid() or public.is_admin())
  )
);

-- project_media
drop policy if exists project_media_select on public.project_media;
create policy project_media_select on public.project_media for select using (
  exists (
    select 1 from public.projects p where p.id = project_media.project_id
    and (p.status = 'published' or p.sub_admin_id = auth.uid() or public.is_admin())
  )
);
drop policy if exists project_media_write on public.project_media;
create policy project_media_write on public.project_media for all using (
  exists (
    select 1 from public.projects p where p.id = project_media.project_id
    and (p.sub_admin_id = auth.uid() or public.is_admin())
  )
) with check (
  exists (
    select 1 from public.projects p where p.id = project_media.project_id
    and (p.sub_admin_id = auth.uid() or public.is_admin())
  )
);

-- leads
drop policy if exists leads_select_admin on public.leads;
create policy leads_select_admin on public.leads for select using (public.is_admin());

drop policy if exists leads_modify_admin on public.leads;
create policy leads_modify_admin on public.leads for update using (public.is_admin());

-- site_visits
drop policy if exists site_visits_all_admin on public.site_visits;
create policy site_visits_all_admin on public.site_visits for all using (public.is_admin()) with check (public.is_admin());
