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
