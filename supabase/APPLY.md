# Applying the Step 1 migrations

Applies the six migrations from branch `fix/security-and-uploads` to the
production Supabase project, one at a time. Every migration works with the
code currently on `main`, so apply them all first, then deploy the code.

| Order | File | Task |
|---|---|---|
| 1 | `20261028000000_restore_signup_phone.sql` | 1.1 |
| 2 | `20261028000100_validate_unit_links_on_update.sql` | 1.2 |
| 3 | `20261028000200_owner_writes_need_active_sub_admin.sql` | 1.3 |
| 4 | `20261028000300_safer_leads.sql` | 1.4 |
| 5 | `20261028000400_unique_plot_numbers.sql` | 1.5 |
| 6 | `20261028000500_bucket_upload_limits.sql` | 1.6 |

Each has a rollback in `supabase/rollbacks/` and checks in `supabase/checks/`.

Run everything from the repo root, on branch `fix/security-and-uploads`.

## 0. Connection

You need the database connection string (Dashboard -> Project Settings ->
Database -> Connection string -> URI, session pooler). Set it once per
terminal session. Bash:

```bash
export DB_URL='postgresql://postgres.<ref>:<password>@<host>:5432/postgres'
```

PowerShell:

```powershell
$env:DB_URL = 'postgresql://postgres.<ref>:<password>@<host>:5432/postgres'
```

`psql` must be installed (PostgreSQL client). Use psql, not the dashboard
SQL editor, for the check files: the editor shows only the last result.

## 1. Backup

```bash
supabase db dump -f schema.sql
supabase db dump --data-only -f data.sql
```

Keep both files outside the repo (or delete them after); they contain
personal data. Check both are non-empty before going on.

## 2. Check the migration history

```bash
supabase migration list
```

This shows two columns, Local and Remote. Expected: every file up to
`20261011000000` appears in both columns, and the six `20261028…` files
appear in Local only.

If it does not match:

- **A version is in Local but not Remote, and it is older than
  `20261028000000`.** Some earlier migrations were applied with
  `supabase db query` and recorded by hand, so the record may be missing even
  though the change is in the database. Check the change itself (for example,
  the column or policy it adds) with a read-only query. If it is there, record
  it without running it again:
  ```bash
  supabase migration repair --status applied <version>
  ```
  If it is not there, stop and ask before going on.
- **A version is in Remote but not Local.** Someone applied a migration that
  is not in this branch. Do not continue. Find where it came from
  (`git log --all -- supabase/migrations`) and merge it into the branch first.
- **Never use `supabase db push` here.** It applies every pending file at
  once; this runbook applies them one by one with checks in between.

## 3. Before you apply: pre-checks

| Before | Run | Must be |
|---|---|---|
| 1.2 | query 1 in `checks/20261028000100_validate_unit_links_on_update.check.sql` | no rows |
| 1.4 | query 1 in `checks/20261028000300_safer_leads.check.sql` | no rows |
| 1.5 | dry run of `checks/1.5_dedupe.sql`, then commit it, then rename Group B plots by hand; then query 1 in `checks/20261028000400_unique_plot_numbers.check.sql` | no rows |
| 1.6 | Dashboard -> Storage -> Settings: global upload limit | at least 50 MB |

Run a single query from a check file by copying it into
`psql "$DB_URL"`, or run a whole file:

```bash
psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/checks/1.5_dedupe.sql
```

## 4. Apply one migration

For each file in the order above:

```bash
# 1. apply it in a single transaction: all or nothing
psql "$DB_URL" -v ON_ERROR_STOP=1 --single-transaction \
  -f supabase/migrations/20261028000000_restore_signup_phone.sql

# 2. record it in the migration history (only if step 1 succeeded)
supabase migration repair --status applied 20261028000000

# 3. run the "AFTER APPLYING" queries in its check file
psql "$DB_URL" -f supabase/checks/20261028000000_restore_signup_phone.check.sql
```

If step 1 fails, nothing was changed: fix the cause (usually a pre-check
that still returns rows) and run it again. Do not run step 2.

Run `supabase migration list` again after each file: that version should
now be in both columns.

## 5. Rollback

If a migration causes a problem after it was applied:

```bash
psql "$DB_URL" -v ON_ERROR_STOP=1 --single-transaction \
  -f supabase/rollbacks/<version>_<name>.rollback.sql
supabase migration repair --status reverted <version>
```

Roll back in reverse order (6 to 1) if several are involved. Read the header
of each rollback file first: some data changes are not undone (the 1.1 phone
backfill, the 1.3 drafting of rejected sub-admins' projects, leads created
while 1.4 was live).

## 6. After all six

1. Run `supabase migration list`: all six in both columns.
2. Deploy the code (merge `fix/security-and-uploads`).
3. Do the manual tests in each check file with the test accounts and the
   test project, then run their cleanup SQL.
