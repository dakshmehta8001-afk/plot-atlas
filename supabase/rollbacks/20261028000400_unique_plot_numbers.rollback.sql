-- Rollback for 20261028000400_unique_plot_numbers.sql (task 1.5).
-- Removes the uniqueness rule. Duplicates you fixed by hand stay fixed.
drop index if exists public.units_unique_plot_number;
