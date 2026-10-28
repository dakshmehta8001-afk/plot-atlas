-- Checks for 20261028000400_unique_plot_numbers.sql (task 1.5).

-- 1. BEFORE APPLYING: duplicate plot numbers per project, using exactly the
--    index's rule. Expect: no rows. Fix every row first (renumber or delete
--    the extra copies); unit_ids are oldest first.
select p.name as project, u.project_id,
       lower(trim(u.unit_number)) as plot_number,
       count(*) as copies,
       array_agg(u.id order by u.created_at) as unit_ids
from public.units u
join public.projects p on p.id = u.project_id
where u.unit_type = 'plot' and u.unit_number <> 'Unlabeled'
group by p.name, u.project_id, lower(trim(u.unit_number))
having count(*) > 1
order by p.name, plot_number;

-- 1b. For information: plots whose number is blank or only spaces. These are
--     NOT excluded by the index (only 'Unlabeled' is), so two of them in one
--     project would also block it; they show up in query 1 as plot_number ''.
select p.name as project, u.id, u.unit_number
from public.units u join public.projects p on p.id = u.project_id
where u.unit_type = 'plot' and trim(u.unit_number) = '';

-- 2. AFTER APPLYING: the index exists. Expect: one row.
select indexname, indexdef from pg_indexes
where schemaname = 'public' and indexname = 'units_unique_plot_number';

-- 3. TEST (rolled back, nothing kept). Use a TEST project and a plot number it
--    already has. Expect: ERROR 23505 duplicate key ... "units_unique_plot_number".
-- begin;
--   insert into public.units (project_id, unit_type, unit_number)
--   values ('<test project id>', 'plot', '<existing plot number>');
-- rollback;

-- 4. TEST: 'Unlabeled' plots are still allowed more than once. Expect: INSERT ok twice.
-- begin;
--   insert into public.units (project_id, unit_type, unit_number) values ('<test project id>', 'plot', 'Unlabeled');
--   insert into public.units (project_id, unit_type, unit_number) values ('<test project id>', 'plot', 'Unlabeled');
-- rollback;

-- Cleanup after the manual UI test: remove plots you added to the TEST project
-- during the test (adjust the numbers to the ones you used).
-- delete from public.units where project_id = '<test project id>' and unit_number in ('<test number>');
