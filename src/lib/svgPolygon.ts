// Tiny shared math for every SVG polygon overlay (tracer, site-plan viewer,
// floor-plan viewer): converting a traced fractional PolygonPoint[] into an
// SVG `points` attribute, and finding a polygon's bounding-box center (used
// to compute the pan/zoom transform that centers a clicked shape).
import { MAP_VIEWBOX_SIZE, type PolygonPoint } from "@/lib/types";

const VB = MAP_VIEWBOX_SIZE;

export function toSvgPoints(points: PolygonPoint[]): string {
  return points.map((p) => `${p.x * VB},${p.y * VB}`).join(" ");
}

// A `<path d="...">` equivalent of the same points — needed for anything a
// `<polyline>`/`<polygon>` can't do, like being the motion path an
// `<animateMotion>` follows via `<mpath>` (that only works off a `<path>`).
export function toSvgPathD(points: PolygonPoint[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x * VB},${p.y * VB}`).join(" ");
}

export function boundingBoxCenter(points: PolygonPoint[]): { x: number; y: number } {
  const xs = points.map((p) => p.x * VB);
  const ys = points.map((p) => p.y * VB);
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
}

// Everything below is additive, for the digitize review canvas's vertex
// editing (src/components/digitize/*) — the manual tracer never needs to
// edit an existing point, only append new ones, so this had no reason to
// exist until now. All pure functions returning a new array; none of the
// three exports above are touched.

export function moveVertex(points: PolygonPoint[], index: number, next: PolygonPoint): PolygonPoint[] {
  return points.map((p, i) => (i === index ? next : p));
}

export function insertVertex(points: PolygonPoint[], afterIndex: number, point: PolygonPoint): PolygonPoint[] {
  const next = [...points];
  next.splice(afterIndex + 1, 0, point);
  return next;
}

export function deleteVertex(points: PolygonPoint[], index: number): PolygonPoint[] {
  return points.filter((_, i) => i !== index);
}

// Finds the closest point on the polygon's own boundary to a click, so
// "double-click an edge to add a point" can insert it in the right place
// rather than just appending to the end. Returns the index it should be
// inserted after and the projected point on that edge (not the raw click
// position — snapping to the edge keeps the boundary from kinking).
export function nearestEdgeInsertion(
  points: PolygonPoint[],
  click: PolygonPoint,
): { afterIndex: number; point: PolygonPoint } {
  let best = { afterIndex: 0, point: points[0], distSq: Infinity };
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const lenSq = abx * abx + aby * aby;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((click.x - a.x) * abx + (click.y - a.y) * aby) / lenSq));
    const proj = { x: a.x + t * abx, y: a.y + t * aby };
    const dx = click.x - proj.x;
    const dy = click.y - proj.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < best.distSq) best = { afterIndex: i, point: proj, distSq };
  }
  return { afterIndex: best.afterIndex, point: best.point };
}

// Shoelace formula in fractional (0..1 x 0..1) units — a rough relative-size
// hint for the review UI only (e.g. sorting/flagging suspiciously tiny or
// huge detected shapes). NOT a real-world area: converting this fraction to
// actual sq ft would need the plan image's real-world scale, which nothing
// in this app captures (no calibration/reference-distance step exists), so
// `area_sqft` stays a manually-typed field same as the rest of the app.
export function polygonAreaFraction(points: PolygonPoint[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}
