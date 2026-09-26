-- Adds real-world scale calibration to a project's plan image, and an
-- explicit per-plot flag for "dimensions couldn't be computed exactly, a
-- human needs to confirm them" — replacing the previous silent NULL
-- (units.dimensions was already nullable with no validation anywhere; see
-- the "calibrated digitization" feature this migration backs).
--
-- map_calibration stores the two points a sub-admin clicked (in the SAME
-- fractional 0..1 PolygonPoint convention every other traced shape uses)
-- plus the real-world distance between them in feet, and separately the
-- plan's north-arrow angle in degrees (0 = up, clockwise) if captured —
-- both set together in the same digitize/calibration UI step, so one jsonb
-- column is simpler than two scattered ones:
--   { pointA: {x,y}, pointB: {x,y}, realDistanceFt: number, northAngleDegrees: number | null }
-- Additive only — existing projects keep map_calibration = null and are
-- completely unaffected (the publish-gate check this enables only fires on
-- a NEW draft -> published transition, never on an already-published row).
alter table public.projects add column map_calibration jsonb null;

-- true whenever a plot's dimensions could not be geometrically computed
-- (no calibration yet, or a shape that isn't a clean quadrilateral) — the
-- explicit "ask, don't guess" signal the publish gate checks, rather than
-- re-deriving "is this plot's dimensions trustworthy" from scratch in two
-- places. Defaults to false so every EXISTING row (all of which predate
-- this flag and were never computed either way) doesn't retroactively
-- block anything already published; only newly-digitized/edited plots
-- going forward set this deliberately.
alter table public.units add column needs_dimension_review boolean not null default false;
