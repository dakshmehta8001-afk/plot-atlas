-- A free-text description field for a unit (plot or flat) - requested
-- directly by a user (2026-10-11): the existing fields (facing, category,
-- rate, dimensions) are all structured/short, with no room for "whatever
-- I want to write additionally" about a specific plot (e.g. "corner plot
-- with extra road frontage", "pending a minor boundary dispute - ask
-- before booking"). Nullable and optional everywhere, same as every other
-- unit field - existing rows just get NULL here until a sub-admin fills
-- it in.
alter table public.units add column description text;
