-- Task 1.5: no duplicate plot numbers within a project.
--
-- The digitizer (saveDigitizedShapes -> save_digitized_shapes RPC) only ever
-- inserts, so saving the same review twice duplicates every plot, and
-- createUnit() has no check either. On 2026-10-28 production already had 35
-- duplicated plot numbers (mostly in "rr", "BALAJI VIHAR ji" and
-- "Naman Infracity").
--
-- A plot number is now unique per project, ignoring case and surrounding
-- spaces ("12", " 12" and "12 " are the same plot). Flats are not covered:
-- flat numbers repeat across floors and wings. Plots saved as 'Unlabeled'
-- (what the digitizer stores for every plot without a number) are excluded,
-- so a project can have any number of unnumbered plots.
--
-- BEFORE APPLYING: this fails if duplicates still exist. Run check query 1 in
-- supabase/checks/20261028000400_unique_plot_numbers.check.sql and fix every
-- row it returns first.
create unique index units_unique_plot_number
  on public.units (project_id, lower(trim(unit_number)))
  where unit_type = 'plot' and unit_number <> 'Unlabeled';
