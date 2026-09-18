-- A project's public business contact details (developer's own phone/
-- WhatsApp/email), shown as quick-contact icons on a unit's info card and
-- editable by the owning sub-admin. This is the developer's own published
-- business contact info (like a storefront's posted phone number) — the
-- sub-admin opts in by filling these in, not someone else's private data,
-- unlike public.users.email/phone which stay private per the existing RLS.
alter table public.projects
  add column contact_phone text,
  add column contact_whatsapp text,
  add column contact_email text;
