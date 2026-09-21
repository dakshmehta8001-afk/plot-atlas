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

// Even-odd ray-casting point-in-polygon test — used by the digitize review
// canvas's Split tool both to highlight whichever shape is under the
// cursor (a live "you're about to cut this one" indicator) and to confirm
// which shape a completed cut line actually passes through.
export function pointInPolygon(point: PolygonPoint, polygon: PolygonPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects = yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

interface EdgeIntersection {
  edgeIndex: number;
  point: PolygonPoint;
}

// Where an INFINITE line through (lineA, lineB) crosses a polygon EDGE (a
// finite segment from a to b). Only the polygon edge is bounded to [0,1] —
// the cutting line itself is unbounded, so the two points the reviewer
// clicks don't need to land precisely on the shape's boundary; the line
// through them is treated as extending as far as needed to fully cross it.
function lineIntersectsSegment(
  lineA: PolygonPoint,
  lineB: PolygonPoint,
  a: PolygonPoint,
  b: PolygonPoint,
): PolygonPoint | null {
  const dx1 = lineB.x - lineA.x;
  const dy1 = lineB.y - lineA.y;
  const dx2 = b.x - a.x;
  const dy2 = b.y - a.y;
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-12) return null; // parallel, or a degenerate zero-length cut line
  const s = ((a.x - lineA.x) * dy1 - (a.y - lineA.y) * dx1) / denom;
  if (s < 0 || s > 1) return null; // crosses the edge's infinite extension, not the edge itself
  return { x: a.x + s * dx2, y: a.y + s * dy2 };
}

// Splits a simple (non-self-intersecting) polygon into two polygons along a
// straight cutting line — the standard GIS "split/knife" tool operation,
// for turning one detected-but-merged blob (or any hand-traced polygon)
// into two separate plots without re-tracing either one from scratch.
//
// Only handles the common case of exactly two boundary crossings — true
// for any convex polygon, and for the near-rectangular/quadrilateral plots
// this tool is meant for. Returns null rather than guessing at a more
// complex topology: a line crossing a concave polygon's boundary 4+ times
// has more than one geometrically valid way to split it, which needs the
// reviewer's actual intent, not an algorithm's guess.
export function splitPolygonWithLine(
  polygon: PolygonPoint[],
  lineA: PolygonPoint,
  lineB: PolygonPoint,
): [PolygonPoint[], PolygonPoint[]] | null {
  const hits: EdgeIntersection[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const point = lineIntersectsSegment(lineA, lineB, a, b);
    if (point) hits.push({ edgeIndex: i, point });
  }

  // A cut passing very close to an existing vertex can register as
  // crossing both of that vertex's adjacent edges — collapse near-
  // duplicate hits before deciding whether this is a clean 2-crossing cut.
  const deduped: EdgeIntersection[] = [];
  for (const hit of hits) {
    const isDuplicate = deduped.some((d) => Math.hypot(d.point.x - hit.point.x, d.point.y - hit.point.y) < 0.002);
    if (!isDuplicate) deduped.push(hit);
  }
  if (deduped.length !== 2) return null;

  const [first, second] = deduped;
  const partA: PolygonPoint[] = [first.point, ...polygon.slice(first.edgeIndex + 1, second.edgeIndex + 1), second.point];
  const partB: PolygonPoint[] = [
    second.point,
    ...polygon.slice(second.edgeIndex + 1),
    ...polygon.slice(0, first.edgeIndex + 1),
    first.point,
  ];

  if (partA.length < 3 || partB.length < 3) return null;
  return [partA, partB];
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
