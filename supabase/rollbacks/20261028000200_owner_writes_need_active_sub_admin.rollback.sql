-- Rollback for 20261028000200_owner_writes_need_active_sub_admin.sql (task 1.3).
-- Puts every changed policy back to its previous definition (from
-- 20260918100000_init_schema.sql, 20260918160000_fix_admin_rls_recursion.sql,
-- 20260919150000_add_roads.sql and 20260920000000_add_site_features.sql),
-- then drops is_active_sub_admin().
--
-- Projects that src/lib/actions/admin.ts set to draft when a sub-admin was
-- rejected are NOT republished by this rollback.

drop policy if exists projects_modify_owner on public.projects;
create policy projects_modify_owner on public.projects for update using (sub_admin_id = auth.uid());
drop policy if exists projects_delete_owner on public.projects;
create policy projects_delete_owner on public.projects for delete using (sub_admin_id = auth.uid());

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

drop policy if exists roads_write on public.roads;
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

drop policy if exists site_features_write on public.site_features;
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

drop policy if exists leads_modify_owner on public.leads;
create policy leads_modify_owner on public.leads for update using (
  exists (select 1 from public.projects p where p.id = leads.project_id and p.sub_admin_id = auth.uid())
);

drop policy if exists site_visits_all_owner on public.site_visits;
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

drop policy if exists plan_images_owner_write on storage.objects;
create policy plan_images_owner_write on storage.objects for insert with check (
  bucket_id = 'plan-images' and (storage.foldername(name))[1] = auth.uid()::text
);
drop policy if exists plan_images_owner_update on storage.objects;
create policy plan_images_owner_update on storage.objects for update using (
  bucket_id = 'plan-images' and (storage.foldername(name))[1] = auth.uid()::text
);
drop policy if exists plan_images_owner_delete on storage.objects;
create policy plan_images_owner_delete on storage.objects for delete using (
  bucket_id = 'plan-images' and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists project_media_owner_write on storage.objects;
create policy project_media_owner_write on storage.objects for insert with check (
  bucket_id = 'project-media' and (storage.foldername(name))[1] = auth.uid()::text
);
drop policy if exists project_media_owner_update on storage.objects;
create policy project_media_owner_update on storage.objects for update using (
  bucket_id = 'project-media' and (storage.foldername(name))[1] = auth.uid()::text
);
drop policy if exists project_media_owner_delete on storage.objects;
create policy project_media_owner_delete on storage.objects for delete using (
  bucket_id = 'project-media' and (storage.foldername(name))[1] = auth.uid()::text
);

drop function if exists public.is_active_sub_admin();
