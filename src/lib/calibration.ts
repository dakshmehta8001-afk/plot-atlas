// Real-world scale math for a project's map_calibration (see the
// MapCalibration interface in src/lib/types.ts): converts the fractional
// 0..1 PolygonPoint coordinates every traced shape already uses into real
// feet, once a sub-admin has calibrated the plan against one known
// distance. Deliberately pure functions with no React/DOM/OpenCV
// dependency, importable from both the digitize editor (computing a
// plot's dimensions as it's traced/edited) and, if ever needed, a viewer.
//
// Every function here takes vbWidth/vbHeight explicitly and multiplies x
// fractions by vbWidth, y fractions by vbHeight — the SAME aspect-ratio-
// correction convention toScaledSvgPoints/scaledBoundingBoxCenter
// (src/lib/svgPolygon.ts) already use. That convention exists specifically
// so 1 unit means the same real screen distance on both axes once vbHeight
// is derived from the plan image's true aspect ratio — which is exactly
// the property this needs too: a single feet-per-unit factor is only
// valid on both axes if they're already isotropic in this way.
import type { PolygonPoint } from "@/lib/types";

function scaledPoint(p: PolygonPoint, vbWidth: number, vbHeight: number): { x: number; y: number } {
  return { x: p.x * vbWidth, y: p.y * vbHeight };
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

// How many real feet one scaled unit (see the file comment above) is
// worth, derived from two calibration points a known real distance apart.
// Returns null for a degenerate calibration (the two points coincide, or a
// non-positive real distance was somehow stored) rather than dividing by
// zero/negative and producing a silently wrong scale.
export function feetPerUnit(
  pointA: PolygonPoint,
  pointB: PolygonPoint,
  realDistanceFt: number,
  vbWidth: number,
  vbHeight: number,
): number | null {
  if (realDistanceFt <= 0) return null;
  const scaledDistance = distance(scaledPoint(pointA, vbWidth, vbHeight), scaledPoint(pointB, vbWidth, vbHeight));
  if (scaledDistance <= 0) return null;
  return realDistanceFt / scaledDistance;
}

// A plot's two real-world side lengths, only for a clean 4-point
// quadrilateral (the overwhelmingly common case for a traced plot) —
// returns null for anything else (a triangle, a pentagon, a merged blob
// from an imperfect auto-detection) rather than guessing at "width" and
// "height" for a shape that doesn't have a single well-defined pair of
// them. That null is exactly the "can't determine exactly, ask instead of
// guessing" signal this whole feature is built around; the caller decides
// what to show for it (see needsDimensionReview in useDetectionPipeline).
export function quadEdgeLengthsFt(
  points: PolygonPoint[],
  feetPerUnitValue: number,
  vbWidth: number,
  vbHeight: number,
): { widthFt: number; heightFt: number } | null {
  if (points.length !== 4) return null;
  const scaled = points.map((p) => scaledPoint(p, vbWidth, vbHeight));
  // A traced quadrilateral's vertices are already in boundary order (the
  // tracer/detector both produce points walking the shape's perimeter, not
  // an arbitrary order), so consecutive edges alternate between the two
  // side lengths of a rectangle-like plot — averaging each pair of
  // opposite edges is more robust to a slightly imprecise trace than
  // trusting a single edge.
  const edge = (i: number) => distance(scaled[i], scaled[(i + 1) % 4]);
  const sideA = (edge(0) + edge(2)) / 2;
  const sideB = (edge(1) + edge(3)) / 2;
  if (sideA <= 0 || sideB <= 0) return null;
  return {
    widthFt: sideA * feetPerUnitValue,
    heightFt: sideB * feetPerUnitValue,
  };
}

// Matches the existing display convention already used for hand-typed
// dimensions and ROAD_WIDTH_PRESETS ("30 ft") — rounded to the nearest
// whole foot, since that's the precision every real plan/legend in this
// app has been seen printing dimensions at (e.g. "30'-0\" x 60'-0\"").
export function formatDimensions(widthFt: number, heightFt: number): string {
  return `${Math.round(widthFt)}' x ${Math.round(heightFt)}'`;
}

// Real area in sq ft via the shoelace formula (same approach as
// polygonAreaFraction in svgPolygon.ts, just scaled into real units by
// feetPerUnit² rather than left as a dimensionless 0..1 fraction) — works
// for any simple polygon, not just quadrilaterals, so this is available
// even for a plot whose exact width/height pair isn't well-defined.
// The plan's true north direction, in degrees, from two clicked points
// (the printed north arrow's tail then tip) — 0 = straight up, increasing
// CLOCKWISE, matching plain CSS `rotate(Ndeg)` directly (positive CSS
// rotation is already clockwise), so Compass.tsx can apply this value with
// no extra sign-flipping. atan2(dx, -dy) rather than the more common
// atan2(dy, dx) specifically because screen/SVG y increases DOWNWARD, so
// "-dy" is what's positive when pointing up — swapping the two atan2
// arguments (dx first) is what then makes 0 correspond to "up" instead of
// "right" and turns the rotation direction clockwise instead of counter-
// clockwise. Uses the same aspect-corrected scaled coordinates as every
// other function here, for the same isotropy reason.
export function northAngleFromPoints(tail: PolygonPoint, tip: PolygonPoint, vbWidth: number, vbHeight: number): number {
  const a = scaledPoint(tail, vbWidth, vbHeight);
  const b = scaledPoint(tip, vbWidth, vbHeight);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const degrees = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return (degrees + 360) % 360;
}

export function polygonAreaSqft(points: PolygonPoint[], feetPerUnitValue: number, vbWidth: number, vbHeight: number): number {
  const scaled = points.map((p) => scaledPoint(p, vbWidth, vbHeight));
  let sum = 0;
  for (let i = 0; i < scaled.length; i++) {
    const a = scaled[i];
    const b = scaled[(i + 1) % scaled.length];
    sum += a.x * b.y - b.x * a.y;
  }
  const areaInScaledUnits = Math.abs(sum) / 2;
  return areaInScaledUnits * feetPerUnitValue * feetPerUnitValue;
}
