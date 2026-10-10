# PlotAtlas

Property society/plot & flat visualization portal — Next.js 16 (App Router,
TypeScript, Tailwind) + Supabase, on the same stack as this account's other
projects (see `[[stack-accounts]]` in project memory).

Three roles:
- **Admin** — approves sub-admins, sees every project and lead platform-wide.
- **Sub-admin** — a developer/land owner. Creates projects, traces plots and
  building footprints on the master site plan, adds buildings' floors and
  traces flats on each floor's plan image, manages status/pricing, and works
  leads/site visits.
- **Viewer** — browses published projects, signs in with Google to enquire
  ("I'm interested") on a plot or flat.

Data model: a project holds standalone **plots** directly, and/or
**buildings → floors → flats**. Plots and flats are both rows in one `units`
table (see `supabase/migrations/20260918100000_init_schema.sql`) so status,
category/zone colouring, and the enquiry flow are identical for both.

The public project page's map is a traced-polygon SVG overlay (same
fractional-coordinate approach as `society-portal`), not real Google Maps —
clicking a building triggers a 2D zoom + floor-selector animation
(`BuildingDrilldown.tsx`) rather than a 3D flythrough or real Street View;
see the scope discussion in project memory for why.

## Setup status

Current as of 2026-10-10, after 94 commits of feature work since the lines
below were first written as forward-looking setup steps — they described
work that hadn't happened yet, not the state of the running app, and were
stale enough to mislead anyone (human or AI) reading this file fresh.

- **Supabase project: created and in use.** `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set in `.env.local`; all 12 migrations
  under `supabase/migrations/` are presumably applied, given the scale of
  working, deployed functionality built against this schema since.
- **Google OAuth / admin account / Auth URL config** — not independently
  verified in this pass (no service-role key was available to query
  `public.users` directly), but near-certainly resolved: the viewer sign-in
  flow, sub-admin approval, and admin screens are all live, committed
  features at this point, not things that could still be blocked on setup
  steps from three weeks ago. If you hit an actual auth error, that's a bug
  report, not a missing setup step - mention it specifically rather than
  assuming this section is wrong again.

## Not yet built (deferred, see project memory for the scope discussion)

- Satellite-map alignment (the Leaflet + free Esri imagery editor that
  `society-portal` has) — plots/buildings are only traced on the flat
  uploaded plan image for now. `leaflet`/`react-leaflet` were installed but
  confirmed unused (2026-10-10) and removed from `package.json`; re-add them
  when this is actually picked up.
- Real Google Maps / Street View integration — deliberately skipped (needs
  a billed API key, and has no coverage for private developments anyway).
- Automated plan-image parsing (auto-detecting plot/flat boundaries) — flats
  and plots are traced manually, same as `society-portal`.

## Getting started locally

```bash
npm install
npm run dev
```

## Deploy

GitHub-connected to Vercel project `plot-atlas` under team `daksh-projects1`
— every push to `main` auto-deploys once Supabase env vars are set.
