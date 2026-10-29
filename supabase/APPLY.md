# Applying the Step 1 migrations

Apply the six migrations one at a time. Every migration is compatible with
the code on `main`, so apply them all before deploying the branch.

Run everything from the repo root, on branch `fix/security-and-uploads`,
in PowerShell.

---

## 0. Set up

### 0a. Link the project (skip if already linked)

Check whether the project is already linked:

```powershell
Test-Path supabase\.temp\project-ref
```

If it prints `True`, skip to **0b**. Otherwise:

```powershell
supabase login          # opens a browser; paste your token
supabase link --project-ref <ref>   # ref = the 20-char string from your dashboard URL
```

### 0b. Install psql (skip if already installed)

```powershell
psql --version
```

If that fails, install the PostgreSQL client:

```powershell
winget install PostgreSQL.PostgreSQL
```

Or download the Windows installer from
https://www.postgresql.org/download/windows/ (uncheck the server and PgAdmin
components; only the command line tools are needed).

Restart the terminal after installing.

**Fallback — Supabase SQL editor:** the editor can run single statements, but
it only shows the last result set. Use it only for the structural after-queries
(policy checks, index existence). Do not use it for the check files that print
four result sets (`1.5_dedupe.sql`), and do not rely on it for the `--single-transaction`
guarantee.

### 0c. Connection string

Dashboard → **Project Settings** → **Database** → **Connection string** →
choose **Session pooler** (works on IPv4; the direct connection requires IPv6
on most home networks).

Copy the URI. It looks like:
`postgresql://postgres.<ref>:<password>@aws-0-ap-south-1.pooler.supabase.com:6543/postgres`

Set it for this terminal session only — never put the password in a file or
commit it:

```powershell
$env:DATABASE_URL = 'postgresql://postgres.<ref>:<password>@<host>:6543/postgres'
```

Verify:

```powershell
psql $env:DATABASE_URL -c "select current_user, version();"
```

### 0d. Backup

```powershell
supabase db dump -f schema.sql
supabase db dump --data-only -f data.sql
```

Check both files are non-empty before going on. Keep them outside the repo
(or delete after); they contain personal data.

### 0e. Check migration history

```powershell
supabase migration list
```

Expected: every file up to `20261011000000` is in both Local and Remote
columns; the six `20261028…` files are in Local only.

**If a version is in Local but not Remote (older than `20261028000000`):**
It was probably applied with `supabase db query` and not recorded. Verify the
change exists in the database (e.g. the column or policy it adds), then
record it:

```powershell
supabase migration repair --status applied <version>
```

**If a version is in Remote but not Local:** Stop. Find it with
`git log --all -- supabase/migrations` and merge it into the branch first.

**Never use `supabase db push`.** It applies every pending file at once with
no checks in between.

---

## How to apply one migration

For each migration below, the steps are:

1. **Pre-check** — run the listed query; if it returns rows, stop and fix first.
2. **Apply** — psql with `--single-transaction`; if it exits with any error,
   nothing was changed. Fix the cause and rerun. Do not go to step 3.
3. **Repair** — **only if step 2 printed no errors:**
   ```powershell
   supabase migration repair --status applied <version>
   ```
   Then run `supabase migration list` and confirm that version is now in both
   columns.
4. **After-queries** — structural checks (policy names, trigger existence).
5. **Tests** — impersonation tests inside `begin … rollback`; use test accounts.
6. **Cleanup** — delete any data the tests created.

---

## Migration 1: task 1.1 — restore signup phone

**File:** `supabase/migrations/20261028000000_restore_signup_phone.sql`

No pre-check needed.

```powershell
psql $env:DATABASE_URL -v ON_ERROR_STOP=1 --single-transaction `
  -f supabase/migrations/20261028000000_restore_signup_phone.sql
```

**Repair (only if no errors above):**

```powershell
supabase migration repair --status applied 20261028000000
supabase migration list
```

**After-queries** — run queries 2–5 in the check file:

```powershell
psql $env:DATABASE_URL -f supabase/checks/20261028000000_restore_signup_phone.check.sql
```

Expect:
- Query 2 (trigger body): contains `phone` and `nullif`.
- Query 3 (backfilled users): a count — read it; these users had no phone before.
- Queries 4–5: impersonation tests return the profile values, not the inserted fakes.

**Cleanup:** the impersonation tests roll back automatically.

---

## Migration 2: task 1.2 — validate unit links on update

**File:** `supabase/migrations/20261028000100_validate_unit_links_on_update.sql`

**Pre-check:** query 1 in the check file must return no rows before applying.

```powershell
psql $env:DATABASE_URL -c @"
select u.id, u.project_id, u.building_id, u.floor_id, u.unit_number
from public.units u
where u.building_id is not null
  and not exists (select 1 from public.buildings b where b.id = u.building_id and b.project_id = u.project_id)
union all
select u.id, u.project_id, u.building_id, u.floor_id, u.unit_number
from public.units u
where u.floor_id is not null
  and not exists (select 1 from public.floors f where f.id = u.floor_id and f.building_id = u.building_id);
"@
```

If it returns rows, fix the inconsistent units first.

```powershell
psql $env:DATABASE_URL -v ON_ERROR_STOP=1 --single-transaction `
  -f supabase/migrations/20261028000100_validate_unit_links_on_update.sql
```

**Repair:**

```powershell
supabase migration repair --status applied 20261028000100
supabase migration list
```

**After-queries:**

```powershell
psql $env:DATABASE_URL -f supabase/checks/20261028000100_validate_unit_links_on_update.check.sql
```

Expect: trigger exists on `before insert or update`; tests reject bad
building/floor combos.

---

## Migration 3: task 1.3 — owner writes need active sub-admin

**File:** `supabase/migrations/20261028000200_owner_writes_need_active_sub_admin.sql`

No pre-check needed.

```powershell
psql $env:DATABASE_URL -v ON_ERROR_STOP=1 --single-transaction `
  -f supabase/migrations/20261028000200_owner_writes_need_active_sub_admin.sql
```

**Repair:**

```powershell
supabase migration repair --status applied 20261028000200
supabase migration list
```

**After-queries:**

```powershell
psql $env:DATABASE_URL -f supabase/checks/20261028000200_owner_writes_need_active_sub_admin.check.sql
```

Expect: 16 policy checks all return true; query 4 lists published projects
whose owner's sub-admin status is not 'active'.

**Stop here and review check query 4.** Projects returned by query 4 belong
to sub-admins who were rejected or never approved. Decide whether to leave
them published or draft them before applying migration 4. The `setSubAdminStatus`
action in `src/lib/actions/admin.ts` already drafts a project when its owner is
rejected going forward, but projects rejected *before this migration* were left
for your review (see task 1.3 decision).

Resume with migration 4 only after you have reviewed and handled those projects.

---

## Migration 4: task 1.4 + 1.4b — safer leads

**File:** `supabase/migrations/20261028000300_safer_leads.sql`

(1.4b's changes — forcing lead status to `'new'` — are in this same file.)

**Pre-check:** query 1 in the check file must return no rows.

```powershell
psql $env:DATABASE_URL -c @"
select viewer_id, unit_id, count(*) as copies, array_agg(id order by created_at) as lead_ids
from public.leads
where unit_id is not null
group by viewer_id, unit_id
having count(*) > 1;
"@
```

If rows are returned, there are duplicate leads that would block the unique
index. Resolve them (delete or merge) before applying.

```powershell
psql $env:DATABASE_URL -v ON_ERROR_STOP=1 --single-transaction `
  -f supabase/migrations/20261028000300_safer_leads.sql
```

**Repair:**

```powershell
supabase migration repair --status applied 20261028000300
supabase migration list
```

**After-queries:**

```powershell
psql $env:DATABASE_URL -f supabase/checks/20261028000300_safer_leads.check.sql
```

Expect: queries 2–3 return true; query 4f confirms the trigger forces
status `'new'`.

**Tests (4a–4e):** uncomment each block in the check file, fill in your
test viewer id, published project, draft project, and unit ids, then run
them one at a time with `psql $env:DATABASE_URL`.

**Cleanup:**

```powershell
psql $env:DATABASE_URL -c "delete from public.leads where viewer_id = '<test-viewer-id>';"
```

---

## Migration 5: dedupe — before applying 1.5

This is not a migration file. It cleans up duplicate plot numbers so the
unique index in migration 6 (1.5) can be created.

### 5a. Dry run

```powershell
psql $env:DATABASE_URL -f supabase/checks/1.5_dedupe.sql
```

Read all four result sets:

- **Result 1:** every duplicate group, with Group A (same shape, will be
  deleted) and Group B (different shape, rename by hand).
- **Result 2:** the Group B plots to rename.
- **Result 3:** planned change counts — leads to move and delete.
- **Result 4:** after-state — `remaining_duplicate_groups` equals the Group B
  count; `leads_not_on_kept_plot` and `duplicate_viewer_leads` must be 0.

The file ends with `ROLLBACK`, so nothing is saved.

### 5b. Rename Group B plots by hand

For each unit_id in result 2, update `unit_number` to something unique
(e.g. append a suffix). Use the dashboard table editor or:

```powershell
psql $env:DATABASE_URL -c "update public.units set unit_number = '<new name>' where id = '<unit-id>';"
```

### 5c. Real run

When result 2 is empty (all Group B plots renamed), change the last line of
`supabase/checks/1.5_dedupe.sql` from `rollback;` to `commit;` and run again:

```powershell
psql $env:DATABASE_URL -f supabase/checks/1.5_dedupe.sql
```

Revert the file change after:

```powershell
git checkout -- supabase/checks/1.5_dedupe.sql
```

### 5d. Verify

```powershell
psql $env:DATABASE_URL -c @"
select project_id, lower(trim(unit_number)) as num_key, count(*)
from public.units
where unit_type = 'plot' and unit_number <> 'Unlabeled'
group by project_id, lower(trim(unit_number))
having count(*) > 1;
"@
```

Must return no rows before continuing.

---

## Migration 6: task 1.5 — unique plot numbers

**File:** `supabase/migrations/20261028000400_unique_plot_numbers.sql`

Pre-check: step 5d above must return no rows.

```powershell
psql $env:DATABASE_URL -v ON_ERROR_STOP=1 --single-transaction `
  -f supabase/migrations/20261028000400_unique_plot_numbers.sql
```

**Repair:**

```powershell
supabase migration repair --status applied 20261028000400
supabase migration list
```

**After-queries:**

```powershell
psql $env:DATABASE_URL -f supabase/checks/20261028000400_unique_plot_numbers.check.sql
```

Expect: index `units_unique_plot_number` exists; inserting a duplicate
plot number is refused.

---

## Migration 7: task 1.6 — bucket upload limits

**File:** `supabase/migrations/20261028000500_bucket_upload_limits.sql`

**Pre-check:** confirm the project's global storage upload limit is at least
50 MB. Dashboard → **Storage** → **Settings** → global limit. If it is below
50 MB, the 50 MB bucket limit silently does nothing — raise the global limit
first.

Also run the pre-check query in the check file to list any already-stored
files that exceed the new limits:

```powershell
psql $env:DATABASE_URL -f supabase/checks/20261028000500_bucket_upload_limits.check.sql
```

Read the output before applying. Those files will not be deleted, but new
uploads of the same size will be refused.

```powershell
psql $env:DATABASE_URL -v ON_ERROR_STOP=1 --single-transaction `
  -f supabase/migrations/20261028000500_bucket_upload_limits.sql
```

**Repair:**

```powershell
supabase migration repair --status applied 20261028000500
supabase migration list
```

**After-queries:** run the check file again and confirm both buckets now show
the correct limits.

---

## Rollback

If a migration causes a problem after it was applied, roll it back before
the next one in reverse order (7 → 1):

```powershell
psql $env:DATABASE_URL -v ON_ERROR_STOP=1 --single-transaction `
  -f supabase/rollbacks/<version>_<name>.rollback.sql
supabase migration repair --status reverted <version>
```

Read the rollback file's header first. Some changes are not reversible:
- 1.1: the phone backfill stays.
- 1.3: projects that were drafted when a sub-admin was rejected stay drafted.
- 1.4: leads created while 1.4 was live stay.
- 5c: Group A plots that were deleted and their moved leads stay changed.

---

## After all seven

1. `supabase migration list` — all six `20261028…` versions in both columns.
2. Merge `fix/security-and-uploads` to `main` and let Vercel deploy.
3. Run the browser tests in each check file using test accounts and the test
   project.
4. Delete the `schema.sql` and `data.sql` backup files.
