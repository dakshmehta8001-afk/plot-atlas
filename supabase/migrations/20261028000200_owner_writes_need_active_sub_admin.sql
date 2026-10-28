-- Task 1.3: only ACTIVE sub-admins (or admins) can write.
--
-- Every owner write policy checked only "sub_admin_id = auth.uid()". A
-- sub-admin that an admin has rejected (users.status = 'rejected') still
-- passed it, so they could keep editing, publishing and uploading, and their
-- projects stayed public. Only projects_insert_owner already required an
-- active sub-admin.
--
-- New rule for every owner WRITE policy:
--   (owner check AND is_active_sub_admin()) OR is_admin()
-- Read (select) policies are not changed, so a rejected sub-admin can still
-- sign in and see their own data, and published projects stay readable until
-- the admin action in src/lib/actions/admin.ts sets them to draft.
--
-- Tables with separate owner and admin policies (projects, leads,
-- site_visits) keep their admin policies as they are; only the owner policy
-- gains the active check. Policies with the owner and admin checks combined
-- (buildings, floors, units, project_media, roads, site_features, storage)
-- are rewritten with the rule above. The owner checks themselves are copied
-- unchanged from their latest versions.
--
-- Storage: the plan-images and project-media insert/update/delete policies
-- only checked that the object sits in a folder named after the caller, so
-- ANY signed-in user (including a Google viewer or a pending sub-admin)
-- could upload to these public buckets. They now also need an active
-- sub-admin, or an admin (who can write in any folder of the two buckets).

create function public.is_active_sub_admin()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and role = 'sub_admin' and status = 'active'
  );
$$;

-- ---------------------------------------------------------------- projects
-- (projects_insert_owner already requires an active sub-admin; unchanged.)
drop policy if exists projects_modify_owner on public.projects;
create policy projects_modify_owner on public.projects for update
  using (sub_admin_id = auth.uid() and public.is_active_sub_admin())
  with check (sub_admin_id = auth.uid() and public.is_active_sub_admin());

drop policy if exists projects_delete_owner on public.projects;
create policy projects_delete_owner on public.projects for delete
  using (sub_admin_id = auth.uid() and public.is_active_sub_admin());

-- --------------------------------------------------------------- buildings
drop policy if exists buildings_write on public.buildings;
create policy buildings_write on public.buildings for all using (
  exists (
    select 1 from public.projects p where p.id = buildings.project_id
    and ((p.sub_admin_id = auth.uid() and public.is_active_sub_admin()) or public.is_admin())
  )
) with check (
  exists (
    select 1 from public.projects p where p.id = buildings.project_id
    and ((p.sub_admin_id = auth.uid() and public.is_active_sub_admin()) or public.is_admin())
  )
);

-- ------------------------------------------------------------------ floors
drop policy if exists floors_write on public.floors;
create policy floors_write on public.floors for all using (
  exists (
    select 1 from public.buildings b join public.projects p on p.id = b.project_id
    where b.id = floors.building_id
    and ((p.sub_admin_id = auth.uid() and public.is_active_sub_admin()) or public.is_admin())
  )
) with check (
  exists (
    select 1 from public.buildings b join public.projects p on p.id = b.project_id
    where b.id = floors.building_id
    and ((p.sub_admin_id = auth.uid() and public.is_active_sub_admin()) or public.is_admin())
  )
);

-- ------------------------------------------------------------------- units
drop policy if exists units_write on public.units;
create policy units_write on public.units for all using (
  exists (
    select 1 from public.projects p where p.id = units.project_id
    and ((p.sub_admin_id = auth.uid() and public.is_active_sub_admin()) or public.is_admin())
  )
) with check (
  exists (
    select 1 from public.projects p where p.id = units.project_id
    and ((p.sub_admin_id = auth.uid() and public.is_active_sub_admin()) or public.is_admin())
  )
);

-- ----------------------------------------------------------- project_media
drop policy if exists project_media_write on public.project_media;
create policy project_media_write on public.project_media for all using (
  exists (
    select 1 from public.projects p where p.id = project_media.project_id
    and ((p.sub_admin_id = auth.uid() and public.is_active_sub_admin()) or public.is_admin())
  )
) with check (
  exists (
    select 1 from public.projects p where p.id = project_media.project_id
    and ((p.sub_admin_id = auth.uid() and public.is_active_sub_admin()) or public.is_admin())
  )
);

-- ------------------------------------------------------------------- roads
drop policy if exists roads_write on public.roads;
create policy roads_write on public.roads for all using (
  exists (
    select 1 from public.projects p where p.id = roads.project_id
    and ((p.sub_admin_id = auth.uid() and public.is_active_sub_admin()) or public.is_admin())
  )
) with check (
  exists (
    select 1 from public.projects p where p.id = roads.project_id
    and ((p.sub_admin_id = auth.uid() and public.is_active_sub_admin()) or public.is_admin())
  )
);

-- ----------------------------------------------------------- site_features
drop policy if exists site_features_write on public.site_features;
create policy site_features_write on public.site_features for all using (
  exists (
    select 1 from public.projects p where p.id = site_features.project_id
    and ((p.sub_admin_id = auth.uid() and public.is_active_sub_admin()) or public.is_admin())
  )
) with check (
  exists (
    select 1 from public.projects p where p.id = site_features.project_id
    and ((p.sub_admin_id = auth.uid() and public.is_active_sub_admin()) or public.is_admin())
  )
);

-- ------------------------------------------------------------------- leads
-- (leads_modify_admin is unchanged.)
drop policy if exists leads_modify_owner on public.leads;
create policy leads_modify_owner on public.leads for update using (
  exists (select 1 from public.projects p where p.id = leads.project_id and p.sub_admin_id = auth.uid())
  and public.is_active_sub_admin()
) with check (
  exists (select 1 from public.projects p where p.id = leads.project_id and p.sub_admin_id = auth.uid())
  and public.is_active_sub_admin()
);

-- ------------------------------------------------------------- site_visits
-- (site_visits_all_admin is unchanged.)
drop policy if exists site_visits_all_owner on public.site_visits;
create policy site_visits_all_owner on public.site_visits for all using (
  exists (
    select 1 from public.leads l join public.projects p on p.id = l.project_id
    where l.id = site_visits.lead_id and p.sub_admin_id = auth.uid()
  )
  and public.is_active_sub_admin()
) with check (
  exists (
    select 1 from public.leads l join public.projects p on p.id = l.project_id
    where l.id = site_visits.lead_id and p.sub_admin_id = auth.uid()
  )
  and public.is_active_sub_admin()
);

-- ----------------------------------------------------------------- storage
-- (The public read policies are unchanged.)
drop policy if exists plan_images_owner_write on storage.objects;
create policy plan_images_owner_write on storage.objects for insert with check (
  bucket_id = 'plan-images' and (
    ((storage.foldername(name))[1] = auth.uid()::text and public.is_active_sub_admin())
    or public.is_admin()
  )
);
drop policy if exists plan_images_owner_update on storage.objects;
create policy plan_images_owner_update on storage.objects for update using (
  bucket_id = 'plan-images' and (
    ((storage.foldername(name))[1] = auth.uid()::text and public.is_active_sub_admin())
    or public.is_admin()
  )
) with check (
  bucket_id = 'plan-images' and (
    ((storage.foldername(name))[1] = auth.uid()::text and public.is_active_sub_admin())
    or public.is_admin()
  )
);
drop policy if exists plan_images_owner_delete on storage.objects;
create policy plan_images_owner_delete on storage.objects for delete using (
  bucket_id = 'plan-images' and (
    ((storage.foldername(name))[1] = auth.uid()::text and public.is_active_sub_admin())
    or public.is_admin()
  )
);

drop policy if exists project_media_owner_write on storage.objects;
create policy project_media_owner_write on storage.objects for insert with check (
  bucket_id = 'project-media' and (
    ((storage.foldername(name))[1] = auth.uid()::text and public.is_active_sub_admin())
    or public.is_admin()
  )
);
drop policy if exists project_media_owner_update on storage.objects;
create policy project_media_owner_update on storage.objects for update using (
  bucket_id = 'project-media' and (
    ((storage.foldername(name))[1] = auth.uid()::text and public.is_active_sub_admin())
    or public.is_admin()
  )
) with check (
  bucket_id = 'project-media' and (
    ((storage.foldername(name))[1] = auth.uid()::text and public.is_active_sub_admin())
    or public.is_admin()
  )
);
drop policy if exists project_media_owner_delete on storage.objects;
create policy project_media_owner_delete on storage.objects for delete using (
  bucket_id = 'project-media' and (
    ((storage.foldername(name))[1] = auth.uid()::text and public.is_active_sub_admin())
    or public.is_admin()
  )
);
