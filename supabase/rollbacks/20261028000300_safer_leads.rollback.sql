-- Rollback for 20261028000300_safer_leads.sql (task 1.4).
-- Puts the insert policy back to the init_schema version, and removes the
-- contact trigger and the one-lead-per-unit index. Leads inserted while the
-- migration was live keep the name/email/phone the trigger gave them.
drop index if exists public.leads_one_per_viewer_unit;

drop trigger if exists set_lead_contact_from_profile on public.leads;
drop function if exists public.set_lead_contact_from_profile();

drop policy if exists leads_insert_viewer on public.leads;
create policy leads_insert_viewer on public.leads for insert with check (viewer_id = auth.uid());
