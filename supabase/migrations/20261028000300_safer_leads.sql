-- Task 1.4: safer leads (viewer enquiries).
--
-- leads_insert_viewer only checked viewer_id = auth.uid(). Because the anon
-- key is public, a signed-in viewer could insert a lead directly through
-- PostgREST and:
--   - target any project, including an unpublished draft,
--   - attach a unit that belongs to a different project,
--   - put any name, email and phone they like on it (the developer then
--     contacts someone who never enquired),
--   - send the same enquiry again and again.
--
-- Fixes:
-- 1. The insert policy also requires a published project and, when unit_id
--    is set, a unit that belongs to that project.
-- 2. A BEFORE INSERT trigger copies name, email and phone from public.users
--    for viewer_id, ignoring whatever the client sent. createLead()
--    (src/lib/actions/leads.ts) already sends the same values, so it keeps
--    working unchanged.
-- 3. One lead per viewer per unit (a unique index). Leads without a unit,
--    and leads whose viewer was deleted (viewer_id set to NULL), are not
--    limited.

drop policy if exists leads_insert_viewer on public.leads;
create policy leads_insert_viewer on public.leads for insert with check (
  viewer_id = auth.uid()
  and exists (
    select 1 from public.projects p
    where p.id = leads.project_id and p.status = 'published'
  )
  and (
    leads.unit_id is null
    or exists (
      select 1 from public.units u
      where u.id = leads.unit_id and u.project_id = leads.project_id
    )
  )
);

-- SECURITY DEFINER so it can always read the viewer's own profile row,
-- whatever the caller's RLS view of public.users is.
create function public.set_lead_contact_from_profile()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  profile record;
begin
  if new.viewer_id is null then
    return new;
  end if;

  select name, email, phone into profile from public.users where id = new.viewer_id;
  if not found then
    raise exception 'viewer % has no profile', new.viewer_id;
  end if;

  -- Same fallbacks createLead() uses: name, else email, else 'Viewer'.
  new.name := coalesce(nullif(trim(profile.name), ''), profile.email, 'Viewer');
  new.email := profile.email;
  new.phone := profile.phone;
  return new;
end;
$$;

create trigger set_lead_contact_from_profile
  before insert on public.leads
  for each row execute function public.set_lead_contact_from_profile();

create unique index leads_one_per_viewer_unit
  on public.leads (viewer_id, unit_id)
  where unit_id is not null;
