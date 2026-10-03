// Pure geometry for the public site map's "scenery": how wide each road
// really is (the gap between the plot blocks either side of it), the grass
// ground and boundary wall around the site, where trees go, and a thin
// inset outline for a plot. No React/DOM here, so it can be unit-tested and
// is computed ONCE per data change (see SitePlanViewer's useMemo), never per
// pan/zoom frame — that is what keeps the map smooth on low-end phones.
//
// Everything is in "scaled" map units: x = fraction * VB, y = fraction *
// vbHeight (the same convention toScaledSvgPoints uses).
import type { PolygonPoint } from "@/lib/types";
import { connectRoads, edgeMidpoint, roadMetrics, type Network } from "@/lib/mapTraffic";

export interface Pt {
  x: number;
  y: number;
}

export interface Poly {
  pts: Pt[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function toPoly(points: PolygonPoint[], vb: number, vbHeight: number): Poly {
  const pts = points.map((p) => ({ x: p.x * vb, y: p.y * vbHeight }));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { pts, minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

export function inPoly(x: number, y: number, poly: Poly): boolean {
  if (x < poly.minX || x > poly.maxX || y < poly.minY || y > poly.maxY) return false;
  const p = poly.pts;
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const intersects = p[i].y > y !== p[j].y > y && x < ((p[j].x - p[i].x) * (y - p[i].y)) / (p[j].y - p[i].y) + p[i].x;
    if (intersects) inside = !inside;
  }
  return inside;
}

// A plot's outline pulled inward by `d` map units on every side (mitred at
// the corners). Used for the thin zone-colour inner border. Returns null
// when the result isn't a clean, smaller copy still inside the plot (a very
// thin or concave plot) — the caller then simply skips the inner border.
export function insetPolygon(poly: Poly, d: number): Pt[] | null {
  const p = poly.pts;
  const n = p.length;
  if (n < 3) return null;
  let area = 0;
  for (let i = 0; i < n; i++) area += p[i].x * p[(i + 1) % n].y - p[(i + 1) % n].x * p[i].y;
  if (area === 0) return null;
  const s = area > 0 ? 1 : -1;
  const inward = (a: Pt, b: Pt): Pt => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: (s * -dy) / len, y: (s * dx) / len };
  };
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const prev = p[(i + n - 1) % n];
    const cur = p[i];
    const next = p[(i + 1) % n];
    const n1 = inward(prev, cur);
    const n2 = inward(cur, next);
    const k = Math.max(0.3, 1 + n1.x * n2.x + n1.y * n2.y);
    out.push({ x: cur.x + ((n1.x + n2.x) * d) / k, y: cur.y + ((n1.y + n2.y) * d) / k });
  }
  const full = { ...poly, pts: p };
  if (!out.every((q) => inPoly(q.x, q.y, full))) return null;
  // A plot thinner than 2*d turns inside-out: all corners still land inside
  // the plot, but the outline's winding flips. Reject that.
  let innerArea = 0;
  for (let i = 0; i < n; i++) innerArea += out[i].x * out[(i + 1) % n].y - out[(i + 1) % n].x * out[i].y;
  if (innerArea * area <= 0 || Math.abs(innerArea) >= Math.abs(area)) return null;
  return out;
}

function distToSegment(x: number, y: number, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lenSq));
  return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
}

function distToPath(x: number, y: number, path: Pt[]): number {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) best = Math.min(best, distToSegment(x, y, path[i - 1], path[i]));
  return best;
}

// Point and unit direction at fraction t of the path's total length.
function pathAt(path: Pt[], t: number): { x: number; y: number; tx: number; ty: number } {
  const lens: number[] = [];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const l = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    lens.push(l);
    total += l;
  }
  let remaining = total * t;
  for (let i = 0; i < lens.length; i++) {
    if (remaining <= lens[i] || i === lens.length - 1) {
      const u = lens[i] === 0 ? 0 : Math.min(1, remaining / lens[i]);
      const dx = path[i + 1].x - path[i].x;
      const dy = path[i + 1].y - path[i].y;
      const len = Math.hypot(dx, dy) || 1;
      return { x: path[i].x + dx * u, y: path[i].y + dy * u, tx: dx / len, ty: dy / len };
    }
    remaining -= lens[i];
  }
  return { x: path[0].x, y: path[0].y, tx: 1, ty: 0 };
}

const WIDTH_SAMPLES = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
const WIDTH_STEP = 2;

// The real gap a road fills: from the road's centre line, step outward on
// each side until hitting a plot, at several points along its length, and
// take the median. A road along the site's edge (plots on one side only)
// uses twice the one-sided distance. null when too few samples found any
// plot — the caller then falls back to the road's printed width label.
export function measureRoadGap(path: Pt[], plots: Poly[], maxReach: number): number | null {
  if (path.length < 2 || plots.length === 0) return null;
  const found: number[] = [];
  for (const t of WIDTH_SAMPLES) {
    const c = pathAt(path, t);
    if (plots.some((pl) => inPoly(c.x, c.y, pl))) continue; // centre line runs through a plot: not a clean gap sample
    const nx = -c.ty;
    const ny = c.tx;
    const reach = (side: number): number | null => {
      for (let d = WIDTH_STEP; d <= maxReach; d += WIDTH_STEP) {
        const x = c.x + nx * side * d;
        const y = c.y + ny * side * d;
        if (plots.some((pl) => inPoly(x, y, pl))) return d;
      }
      return null;
    };
    const a = reach(1);
    const b = reach(-1);
    if (a !== null && b !== null) found.push(a + b);
    else if (a !== null || b !== null) found.push(2 * (a ?? b ?? 0));
  }
  if (found.length < 3) return null;
  found.sort((x, y) => x - y);
  return found[Math.floor(found.length / 2)];
}

export interface RoadGeom {
  id: string;
  points: string;
  width: number;
  label: string;
  /** Where the width label sits: on the pavement strip, rotated along the road (never upside down). */
  labelPos: { x: number; y: number; angle: number };
  length: number;
}

export interface Tree {
  x: number;
  y: number;
  scale: number;
  variant: 0 | 1;
}

export interface Scene {
  ground: { x: number; y: number; w: number; h: number; wall: { x: number; y: number; w: number; h: number } } | null;
  trees: Tree[];
  roads: RoadGeom[];
  /** Road graph used by the traffic simulation; also supplies the DRAWN (extended/trimmed) road paths. */
  network: Network;
}

interface RoadInput {
  id: string;
  width_label: string;
  path_points: PolygonPoint[];
}

const MIN_ROAD_WIDTH = 10;
const MAX_ROAD_WIDTH_FRACTION = 0.14;
const TREE_RING_SPACING = 24;
const TREE_ROAD_SPACING = 30;
const TREE_MIN_GAP = 17;
const MAX_TREES = 150;

// Cheap, stable pseudo-random in [0,1) from an integer, so tree sizes/jitter
// don't change between renders (no Math.random in render).
function hash01(i: number): number {
  const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

export function buildScene(
  roads: RoadInput[],
  plots: { polygon_points: PolygonPoint[] }[],
  others: { polygon_points: PolygonPoint[] }[],
  vb: number,
  vbHeight: number,
  fallbackWidth: (label: string) => number,
): Scene {
  const plotPolys = plots.filter((p) => p.polygon_points.length >= 3).map((p) => toPoly(p.polygon_points, vb, vbHeight));
  const otherPolys = others.filter((p) => p.polygon_points.length >= 3).map((p) => toPoly(p.polygon_points, vb, vbHeight));
  const blockers = [...plotPolys, ...otherPolys];

  const raw: { id: string; label: string; path: Pt[]; width: number }[] = [];
  for (const r of roads) {
    if (r.path_points.length < 2) continue;
    const path = r.path_points.map((p) => ({ x: p.x * vb, y: p.y * vbHeight }));
    const measured = measureRoadGap(path, plotPolys, vb * 0.1);
    const width = Math.min(vb * MAX_ROAD_WIDTH_FRACTION, Math.max(MIN_ROAD_WIDTH, measured ?? fallbackWidth(r.width_label)));
    raw.push({ id: r.id, label: r.width_label, path, width });
  }

  // Join roads that nearly meet (display only — saved data is untouched).
  const network = connectRoads(raw.map((r) => ({ id: r.id, path: r.path, width: r.width })));
  const roadGeoms: (RoadGeom & { path: Pt[] })[] = raw.map((r) => {
    const path = network.paths.get(r.id) ?? r.path;
    const length = path.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - path[i].x, p.y - path[i].y), 0);
    const longest = network.edges.filter((e) => e.roadId === r.id).sort((a, b) => b.len - a.len)[0];
    const m = longest ? edgeMidpoint(longest) : pathAt(path, 0.5);
    const mid = "p" in m ? m.p : { x: m.x, y: m.y };
    const tan = "p" in m ? m.t : { x: m.tx, y: m.ty };
    const lateral = roadMetrics(r.width).walkerLateral;
    let angle = (Math.atan2(tan.y, tan.x) * 180) / Math.PI;
    if (angle > 90) angle -= 180;
    if (angle < -90) angle += 180;
    return {
      id: r.id,
      path,
      points: path.map((p) => `${p.x},${p.y}`).join(" "),
      width: r.width,
      label: r.label,
      labelPos: { x: mid.x + tan.y * lateral, y: mid.y - tan.x * lateral, angle },
      length,
    };
  });

  const all: Pt[] = [...blockers.flatMap((b) => b.pts), ...roadGeoms.flatMap((r) => r.path)];
  if (all.length === 0) return { ground: null, trees: [], roads: [], network };
  const minX = Math.min(...all.map((p) => p.x));
  const maxX = Math.max(...all.map((p) => p.x));
  const minY = Math.min(...all.map((p) => p.y));
  const maxY = Math.max(...all.map((p) => p.y));
  const pad = vb * 0.05;
  const ground = {
    x: minX - pad,
    y: minY - pad,
    w: maxX - minX + 2 * pad,
    h: maxY - minY + 2 * pad,
    wall: { x: minX - pad * 0.82, y: minY - pad * 0.82, w: maxX - minX + 2 * pad * 0.82, h: maxY - minY + 2 * pad * 0.82 },
  };

  const trees: Tree[] = [];
  const nearRoad = (x: number, y: number, extra: number) => roadGeoms.some((r) => distToPath(x, y, r.path) < r.width / 2 + extra);
  const tooClose = (x: number, y: number) => trees.some((t) => Math.hypot(t.x - x, t.y - y) < TREE_MIN_GAP);
  const blocked = (x: number, y: number, r: number) =>
    [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]].some(([dx, dy]) => blockers.some((b) => inPoly(x + dx, y + dy, b)));
  const add = (x: number, y: number, i: number) => {
    if (trees.length >= MAX_TREES) return;
    trees.push({ x, y, scale: 0.85 + hash01(i) * 0.4, variant: hash01(i + 101) > 0.5 ? 1 : 0 });
  };

  // Outer ring: a row of trees just inside the boundary wall.
  const ringInset = pad * 0.42;
  const rx0 = minX - ringInset;
  const rx1 = maxX + ringInset;
  const ry0 = minY - ringInset;
  const ry1 = maxY + ringInset;
  const ringPts: Pt[] = [];
  for (let x = rx0; x <= rx1; x += TREE_RING_SPACING) {
    ringPts.push({ x, y: ry0 }, { x, y: ry1 });
  }
  for (let y = ry0 + TREE_RING_SPACING; y < ry1; y += TREE_RING_SPACING) {
    ringPts.push({ x: rx0, y }, { x: rx1, y });
  }
  ringPts.forEach((p, i) => {
    const jx = p.x + (hash01(i * 3) - 0.5) * 6;
    const jy = p.y + (hash01(i * 3 + 1) - 0.5) * 6;
    if (nearRoad(jx, jy, 10) || blocked(jx, jy, 6)) return;
    add(jx, jy, i);
  });

  // Along roads: wherever there is free ground beside a road (road ends,
  // gaps between plot blocks) — never on top of a plot or another road.
  let seed = 1000;
  for (const r of roadGeoms) {
    const steps = Math.max(1, Math.floor(r.length / TREE_ROAD_SPACING));
    for (let k = 0; k <= steps; k++) {
      const c = pathAt(r.path, steps === 0 ? 0 : k / steps);
      for (const side of [1, -1]) {
        const off = r.width / 2 + 12;
        const x = c.x - c.ty * off * side;
        const y = c.y + c.tx * off * side;
        seed++;
        if (x < ground.wall.x + 10 || x > ground.wall.x + ground.wall.w - 10) continue;
        if (y < ground.wall.y + 10 || y > ground.wall.y + ground.wall.h - 10) continue;
        if (blocked(x, y, 8) || nearRoad(x, y, 8) || tooClose(x, y)) continue;
        add(x, y, seed);
      }
    }
  }

  return {
    ground,
    trees,
    roads: roadGeoms.map((r) => ({ id: r.id, points: r.points, width: r.width, label: r.label, labelPos: r.labelPos, length: r.length })),
    network,
  };
}
