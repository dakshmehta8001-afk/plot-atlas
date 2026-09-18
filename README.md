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

## Manual steps still needed before this is usable

1. **Supabase project not yet created.** The account's Supabase free tier is
   capped at 2 active projects account-wide (not per-org), and 2+ are
   already active (`property-hub`, `society-portal`, `scanner`). A brand
   new org (`PlotAtlas`, id `dmlqmlppsxhvxqqvkhsz`) was created for this
   project but that didn't bypass the cap — it's account-wide. The Supabase
   CLI has no `pause` command (dashboard-only), so this needs one manual
   step: **pause an existing project you're not using right now** at
   supabase.com/dashboard (Project Settings → General → Pause project), or
   upgrade one org to Pro. Once a slot is free, run:
   ```
   supabase projects create plot-atlas --org-id dmlqmlppsxhvxqqvkhsz --region ap-northeast-1 --db-password <see plot-atlas-db-password.txt one level up>
   ```
   then apply `supabase/migrations/20260918100000_init_schema.sql` and fill
   in `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` in
   `.env.local` (and as Vercel project env vars) from the new project's API
   settings.
2. **Google OAuth provider** not yet configured in Supabase Dashboard
   (Authentication → Sign In / Up) — needs a Client ID/secret from a Google
   Cloud OAuth consent screen. Until set, viewer Google sign-in will fail.
3. **Supabase Auth URL Configuration** (Site URL + Redirect URLs) needs to
   point at the live Vercel URL once deployed, for the OAuth/email-
   confirmation redirect to `/auth/callback` to be accepted.
4. **No admin account exists yet.** Sign up via `/signup` (creates a pending
   sub_admin), then in the Supabase SQL editor run:
   `update public.users set role='admin', status='active' where email='...'`.

## Not yet built (deferred, see project memory for the scope discussion)

- Satellite-map alignment (the Leaflet + free Esri imagery editor that
  `society-portal` has) — plots/buildings are only traced on the flat
  uploaded plan image for now. `leaflet`/`react-leaflet` are installed but
  unused pending this.
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
