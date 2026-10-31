-- Task 1.5a: clean up duplicate plot numbers BEFORE applying
-- 20261028000400_unique_plot_numbers.sql. Written, not run.
--
-- A duplicate group = plots in one project with the same number, using the
-- index's rule: unit_type = 'plot', unit_number <> 'Unlabeled', compared on
-- lower(trim(unit_number)).
--
-- In each group the OLDEST plot is the one kept. Every other plot in the
-- group (a "copy") is classified against the kept one:
--   Group A  same number and nearly the same shape (saved twice):
--            its leads move to the kept plot, then the copy is deleted.
--   Group B  same number but a different shape: listed only, nothing
--            changes. Rename these by hand; the index still cannot be
--            created while any remain.
--
-- "Nearly the same shape": both plots have a polygon, and their bounding
-- boxes (left, right, top, bottom, as fractions 0..1 of the plan image)
-- differ by at most SHAPE_TOLERANCE on every side. 0.003 is about 3 units in
-- the 1000-wide map: a re-saved digitizer shape matches exactly, a
-- neighbouring plot does not. Plots with no polygon are always Group B.
--
-- Leads: only leads.unit_id references units. When a copy's lead moves to the
-- kept plot, a viewer could end up with two leads on one plot, which the 1.4
-- unique index on (viewer_id, unit_id) forbids. So per kept plot and viewer,
-- only ONE lead survives: the kept plot's own lead if it has one, otherwise
-- the oldest lead from the copies. The others are deleted (their site visits
-- go with them, by cascade). Leads with no viewer (viewer deleted) just move.
--
-- HOW TO RUN
-- Use psql, not the Supabase SQL editor: the editor only shows the LAST
-- result set, and this file prints four. See supabase/APPLY.md, e.g.
--   psql "$DB_URL" -f supabase/checks/1.5_dedupe.sql
-- 1. Run the whole file as is. It ends with ROLLBACK, so it is a dry run:
--    read the four result sets (groups, Group B list, planned changes,
--    after-state).
-- 2. When the numbers look right, change the last line to COMMIT and run
--    again.
-- 3. Fix the Group B plots by hand, then run check query 1 in
--    20261028000400_unique_plot_numbers.check.sql until it returns no rows.

begin;

-- ------------------------------------------------------------------ setup
create temp table dd_units on commit drop as
with plots as (
  select u.id, u.project_id, u.unit_number, u.created_at, u.polygon_points,
         lower(trim(u.unit_number)) as num_key
  from public.units u
  where u.unit_type = 'plot' and u.unit_number <> 'Unlabeled'
),
groups as (
  select project_id, num_key from plots group by project_id, num_key having count(*) > 1
),
bbox as (
  select p.id,
         min((pt->>'x')::float8) as x0, max((pt->>'x')::float8) as x1,
         min((pt->>'y')::float8) as y0, max((pt->>'y')::float8) as y1
  from plots p
  cross join lateral jsonb_array_elements(case when jsonb_typeof(p.polygon_points) = 'array' then p.polygon_points else '[]'::jsonb end) pt
  group by p.id
)
select p.id, p.project_id, p.unit_number, p.num_key, p.created_at,
       b.x0, b.x1, b.y0, b.y1,
       (select count(*) from public.leads l where l.unit_id = p.id) as lead_count,
       row_number() over (partition by p.project_id, p.num_key order by p.created_at, p.id) as rank_in_group
from plots p
join groups g on g.project_id = p.project_id and g.num_key = p.num_key
left join bbox b on b.id = p.id;

-- Each copy against the kept (oldest) plot of its group.
create temp table dd_copies on commit drop as
with keep as (select * from dd_units where rank_in_group = 1)
select c.id as copy_id, k.id as keep_id, c.project_id, c.num_key,
       coalesce(
         c.x0 is not null and k.x0 is not null
         and abs(c.x0 - k.x0) <= 0.003 and abs(c.x1 - k.x1) <= 0.003
         and abs(c.y0 - k.y0) <= 0.003 and abs(c.y1 - k.y1) <= 0.003,
         false) as same_shape
from dd_units c
join keep k on k.project_id = c.project_id and k.num_key = c.num_key
where c.rank_in_group > 1;

-- ------------------------------------------------- result 1: every group
select pr.name as project, d.num_key as plot_number, d.rank_in_group,
       case when d.rank_in_group = 1 then 'KEEP'
            when c.same_shape then 'A: delete (same shape)'
            else 'B: rename by hand' end as action,
       d.id as unit_id, d.unit_number, d.created_at, d.lead_count,
       round(d.x0::numeric, 4) as x0, round(d.x1::numeric, 4) as x1,
       round(d.y0::numeric, 4) as y0, round(d.y1::numeric, 4) as y1
from dd_units d
join public.projects pr on pr.id = d.project_id
left join dd_copies c on c.copy_id = d.id
order by pr.name, d.num_key, d.rank_in_group;

-- ---------------------------------------- result 2: Group B (list only)
select pr.name as project, c.num_key as plot_number, c.copy_id as unit_id_to_rename, c.keep_id as kept_unit_id
from dd_copies c join public.projects pr on pr.id = c.project_id
where not c.same_shape
order by pr.name, c.num_key;

-- ------------------------------------------------- the Group A changes
-- Leads that would sit on the kept plot after the move, one row per lead.
create temp table dd_leads on commit drop as
select l.id as lead_id, l.viewer_id, l.created_at,
       coalesce(c.keep_id, l.unit_id) as target_unit,
       (c.copy_id is null) as already_on_keep
from public.leads l
left join dd_copies c on c.copy_id = l.unit_id and c.same_shape
where l.unit_id in (select keep_id from dd_copies where same_shape)
   or l.unit_id in (select copy_id from dd_copies where same_shape);

-- Per kept plot and viewer, keep one lead: the kept plot's own first, else the oldest.
create temp table dd_lead_plan on commit drop as
select lead_id, target_unit, already_on_keep,
       case when viewer_id is null then 'move'
            when row_number() over (partition by target_unit, viewer_id
                                    order by already_on_keep desc, created_at, lead_id) = 1
              then case when already_on_keep then 'keep' else 'move' end
            else 'delete' end as lead_action
from dd_leads;

-- ----------------------------------------- result 3: planned change counts
select
  (select count(distinct (project_id, num_key)) from dd_units) as duplicate_groups,
  (select count(*) from dd_copies where same_shape) as group_a_copies_to_delete,
  (select count(*) from dd_copies where not same_shape) as group_b_to_rename_by_hand,
  (select count(*) from dd_lead_plan where lead_action = 'move' and not already_on_keep) as leads_to_move,
  (select count(*) from dd_lead_plan where lead_action = 'delete') as leads_to_delete;

-- Apply: delete the conflicting leads, move the rest, delete the copies.
delete from public.leads l
using dd_lead_plan p
where p.lead_id = l.id and p.lead_action = 'delete';

update public.leads l
set unit_id = p.target_unit
from dd_lead_plan p
where p.lead_id = l.id and p.lead_action = 'move' and not p.already_on_keep;

delete from public.units u
using dd_copies c
where c.copy_id = u.id and c.same_shape;

-- ------------------------------------------------ result 4: after-state
-- remaining_duplicate_groups should equal the number of groups that still
-- contain a Group B plot. leads_not_on_kept_plot and duplicate_viewer_leads
-- must be 0.
select
  (select count(*) from (
     select 1 from public.units
     where unit_type = 'plot' and unit_number <> 'Unlabeled'
     group by project_id, lower(trim(unit_number)) having count(*) > 1) x) as remaining_duplicate_groups,
  (select count(*) from dd_lead_plan p join public.leads l on l.id = p.lead_id
    where l.unit_id is distinct from p.target_unit) as leads_not_on_kept_plot,
  (select count(*) from (
     select 1 from public.leads where unit_id is not null
     group by viewer_id, unit_id having count(*) > 1) y) as duplicate_viewer_leads;

-- Dry run: nothing is kept. Change to COMMIT only after reviewing the results.
rollback;
