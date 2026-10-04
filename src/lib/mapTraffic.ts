// Road network + traffic simulation for the public site map. Pure code (no
// React/DOM) so it can be unit-tested in node. Two halves:
//
//  1. connectRoads(): roads are stored as independent centre lines that
//     often stop just short of each other (a vertical road ends ~50 units
//     below the road it should meet). This finds the junctions, extends
//     (or trims) road ENDS so roads physically meet, and splits roads into
//     graph edges between junction nodes. It changes only what is DRAWN —
//     the saved road data is never touched. A road end is only snapped when
//     the gap is within one road width, so a road meant to end stays a dead
//     end.
//  2. createSim()/stepSim(): cars moving on that graph. Cars
//     keep LEFT, turn along smooth curves at junctions, U-turn at dead
//     ends, keep a gap behind the car in front, and take a per-junction
//     lock so only one car is inside a junction at a time. A car also waits
//     while a walker is crossing (Sim.pedCrossing).
//  3. buildWalkGraph(): the same network cut into straight pieces for the
//     walker sim in mapWalkers.ts (footpaths, crossing only at junctions).
//
import type { WalkEdge, WalkNode } from "./mapWalkers";

// All units are map units (the viewBox is ~1000 wide).

export interface Pt {
  x: number;
  y: number;
}

export interface RoadIn {
  id: string;
  path: Pt[];
  width: number;
}

export interface Edge {
  id: number;
  roadId: string;
  a: number;
  b: number;
  pts: Pt[];
  cum: number[];
  len: number;
  width: number;
}

export interface Node {
  id: number;
  x: number;
  y: number;
  edges: number[];
  radius: number;
  dead: boolean;
}

export interface Network {
  nodes: Node[];
  edges: Edge[];
  /** Road id -> the centre line as it should be DRAWN (ends extended/trimmed). */
  paths: Map<string, Pt[]>;
}

// ---------------------------------------------------------------- geometry

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
const cross = (a: Pt, b: Pt) => a.x * b.y - a.y * b.x;
const norm = (a: Pt): Pt => {
  const l = Math.hypot(a.x, a.y) || 1;
  return { x: a.x / l, y: a.y / l };
};

function cumulative(pts: Pt[]): number[] {
  const c = [0];
  for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return c;
}

function pointAtArc(pts: Pt[], cum: number[], s: number): { p: Pt; t: Pt } {
  const total = cum[cum.length - 1];
  const ss = Math.max(0, Math.min(total, s));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < ss) i++;
  const segLen = cum[i] - cum[i - 1] || 1;
  const u = (ss - cum[i - 1]) / segLen;
  const a = pts[i - 1];
  const b = pts[i];
  return { p: { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u }, t: norm(sub(b, a)) };
}

function nearestOnPath(pts: Pt[], p: Pt): { q: Pt; s: number; t: Pt; dist: number } {
  const cum = cumulative(pts);
  let best = { q: pts[0], s: 0, t: norm(sub(pts[1], pts[0])), dist: Infinity };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const d = sub(b, a);
    const l2 = dot(d, d) || 1;
    const u = Math.max(0, Math.min(1, dot(sub(p, a), d) / l2));
    const q = { x: a.x + d.x * u, y: a.y + d.y * u };
    const dist = Math.hypot(p.x - q.x, p.y - q.y);
    if (dist < best.dist) best = { q, s: cum[i - 1] + Math.hypot(d.x, d.y) * u, t: norm(d), dist };
  }
  return best;
}

function segIntersect(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const r = sub(b, a);
  const s = sub(d, c);
  const den = cross(r, s);
  if (Math.abs(den) < 1e-9) return null;
  const t = cross(sub(c, a), s) / den;
  const u = cross(sub(c, a), r) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a.x + r.x * t, y: a.y + r.y * t };
}

// ----------------------------------------------------------- road metrics

// Cross-section of a road, computed from ITS OWN width so a wider road gets
// slightly bigger cars/walkers than a narrow one. From the edge inwards:
// white edge line, pavement strip (walkers), then two lanes (cars).
export const EDGE_INSET = 2.5;
export const EDGE_LINE = 1.6;
const STRIP_FRAC = 0.1;
const LANE_FILL = 0.8;
const WALKER_FILL = 1.4;
export const CAR_BASE_WIDTH = 17.5;
export const CAR_BASE_LENGTH = 40;
export const WALKER_BASE_WIDTH = 14;

export interface Metrics {
  strip: number;
  carriageway: number;
  laneCenter: number;
  carScale: number;
  walkerScale: number;
  walkerLateral: number;
}

export function roadMetrics(width: number): Metrics {
  const strip = STRIP_FRAC * width;
  const edge = EDGE_INSET + EDGE_LINE;
  const carriageway = Math.max(4, width - 2 * (edge + strip));
  const lane = carriageway / 2;
  return {
    strip,
    carriageway,
    laneCenter: lane / 2,
    carScale: (LANE_FILL * lane) / CAR_BASE_WIDTH,
    walkerScale: (WALKER_FILL * strip) / WALKER_BASE_WIDTH,
    walkerLateral: width / 2 - edge - strip / 2,
  };
}

/**
 * Radius of the asphalt fillet drawn at an L-corner. It runs out to the white
 * edge line (carriageway + the pavement strip), so a car turning through the
 * corner, including its body overhang, always stays on dark asphalt.
 */
export function cornerAsphaltRadius(width: number): number {
  const m = roadMetrics(width);
  return m.carriageway / 2 + m.strip;
}

// ------------------------------------------------------- junction building

const MERGE_TOL = 10;

export function connectRoads(roads: RoadIn[]): Network {
  const work = roads
    .filter((r) => r.path.length >= 2)
    .map((r) => ({ id: r.id, path: r.path.map((p) => ({ ...p })), width: r.width, hw: r.width / 2 }));
  const orig = work.map((r) => r.path.map((p) => ({ ...p })));
  const origCum = orig.map((p) => cumulative(p));

  const joints: Pt[] = [];
  const endMoves = new Map<string, Pt>();

  for (let i = 0; i < work.length; i++) {
    for (const end of [0, 1] as const) {
      const pts = orig[i];
      const P = end === 0 ? pts[0] : pts[pts.length - 1];
      const inner = end === 0 ? pts[1] : pts[pts.length - 2];
      const d = norm(sub(P, inner));

      let best: { j: number; q: Pt; s: number; t: Pt; gap: number } | null = null;
      for (let j = 0; j < work.length; j++) {
        if (j === i) continue;
        const n = nearestOnPath(orig[j], P);
        const gap = n.dist - work[j].hw;
        if (gap > work[i].width) continue; // the snap rule: within one road width
        if (!best || gap < best.gap) best = { j, q: n.q, s: n.s, t: n.t, gap };
      }
      if (!best) continue; // a real dead end

      const wi = work[i];
      const wj = work[best.j];
      let J = best.q;
      // Nearly-parallel roads, or a corner that doesn't line up, are only
      // joined where the end already sits inside the other road's band —
      // never bent or stretched toward each other.
      let connect = best.gap <= 0;
      let newEnd: Pt | null = null;
      let moveOther: Pt | null = null;
      const cr = cross(d, best.t);
      if (Math.abs(cr) >= 0.5) {
        const diff = sub(best.q, P);
        const t = cross(diff, best.t) / cr;
        const u = cross(diff, d) / cr;
        if (Math.abs(t) <= wi.width + wj.hw + wi.hw) {
          const Jc = { x: P.x + d.x * t, y: P.y + d.y * t };
          const along = best.s + u;
          const Lj = origCum[best.j][origCum[best.j].length - 1];
          const beyond = along > Lj ? along - Lj : along < 0 ? -along : 0;
          if (beyond === 0 || beyond - wi.hw <= wj.width) {
            J = Jc;
            connect = true;
            if (beyond > 0) moveOther = Jc;
            if (t >= 0) newEnd = Jc;
            else newEnd = -t > wj.hw ? { x: Jc.x + d.x * wj.hw, y: Jc.y + d.y * wj.hw } : null;
          }
        }
      }
      if (!connect) continue;
      joints.push(J);
      if (newEnd) endMoves.set(`${i}:${end}`, newEnd);
      if (moveOther) {
        const pj = orig[best.j];
        const atStart = best.s <= 1;
        const atEnd = best.s >= origCum[best.j][pj.length - 1] - 1;
        if (atStart || atEnd) {
          const key = `${best.j}:${atStart ? 0 : 1}`;
          if (!endMoves.has(key)) endMoves.set(key, moveOther);
        }
      }
    }
  }

  for (const [key, p] of endMoves) {
    const [i, end] = key.split(":").map(Number);
    const path = work[i].path;
    if (end === 0) path[0] = p;
    else path[path.length - 1] = p;
  }

  // Candidate node positions: joints, centre-line crossings, road ends.
  const cand: Pt[] = [...joints];
  for (let i = 0; i < work.length; i++) {
    for (let j = i + 1; j < work.length; j++) {
      for (let a = 1; a < work[i].path.length; a++) {
        for (let b = 1; b < work[j].path.length; b++) {
          const x = segIntersect(work[i].path[a - 1], work[i].path[a], work[j].path[b - 1], work[j].path[b]);
          if (x) cand.push(x);
        }
      }
    }
  }
  for (const r of work) cand.push(r.path[0], r.path[r.path.length - 1]);

  const clusters: { x: number; y: number; n: number }[] = [];
  for (const p of cand) {
    const c = clusters.find((k) => Math.hypot(k.x - p.x, k.y - p.y) <= MERGE_TOL);
    if (c) {
      c.x = (c.x * c.n + p.x) / (c.n + 1);
      c.y = (c.y * c.n + p.y) / (c.n + 1);
      c.n++;
    } else clusters.push({ x: p.x, y: p.y, n: 1 });
  }
  const nodes: Node[] = clusters.map((c, id) => ({ id, x: c.x, y: c.y, edges: [], radius: 0, dead: false }));

  const edges: Edge[] = [];
  const paths = new Map<string, Pt[]>();
  for (const r of work) {
    paths.set(r.id, r.path);
    const cum = cumulative(r.path);
    const total = cum[cum.length - 1];
    const tol = 12 + 0.25 * r.hw;
    const cuts: { s: number; node: number }[] = [];
    for (const nd of nodes) {
      const n = nearestOnPath(r.path, nd);
      if (n.dist <= tol) cuts.push({ s: n.s, node: nd.id });
    }
    cuts.sort((a, b) => a.s - b.s);
    const dedup: typeof cuts = [];
    for (const c of cuts) {
      const last = dedup[dedup.length - 1];
      if (last && c.s - last.s < 3) continue;
      dedup.push(c);
    }
    if (dedup.length === 0 || dedup[0].s > tol) dedup.unshift({ s: 0, node: nearestNode(nodes, r.path[0]) });
    if (total - dedup[dedup.length - 1].s > tol) dedup.push({ s: total, node: nearestNode(nodes, r.path[r.path.length - 1]) });
    for (let k = 1; k < dedup.length; k++) {
      const c0 = dedup[k - 1];
      const c1 = dedup[k];
      if (c1.s - c0.s < 4 || c0.node === c1.node) continue;
      const pts: Pt[] = [{ x: nodes[c0.node].x, y: nodes[c0.node].y }];
      for (let v = 1; v < r.path.length - 1; v++) if (cum[v] > c0.s + 1 && cum[v] < c1.s - 1) pts.push(r.path[v]);
      pts.push({ x: nodes[c1.node].x, y: nodes[c1.node].y });
      const ecum = cumulative(pts);
      const e: Edge = { id: edges.length, roadId: r.id, a: c0.node, b: c1.node, pts, cum: ecum, len: ecum[ecum.length - 1], width: r.width };
      edges.push(e);
      nodes[c0.node].edges.push(e.id);
      nodes[c1.node].edges.push(e.id);
    }
  }
  for (const nd of nodes) {
    const hw = Math.max(0, ...nd.edges.map((id) => edges[id].width / 2));
    nd.radius = hw + 6;
  }

  // A short stub ending in a dead end (e.g. a road end poking 40 units past a
  // junction) is too short for a car to drive into and clear the junction
  // again. Cars never use it; it is still DRAWN. Two passes catch a stub that
  // only became one after another was removed.
  let kept = edges;
  for (let pass = 0; pass < 2; pass++) {
    const deg = new Map<number, number>();
    for (const e of kept) {
      deg.set(e.a, (deg.get(e.a) ?? 0) + 1);
      deg.set(e.b, (deg.get(e.b) ?? 0) + 1);
    }
    kept = kept.filter((e) => {
      const stubA = deg.get(e.a) === 1;
      const stubB = deg.get(e.b) === 1;
      if (stubA === stubB) return true;
      const other = nodes[stubA ? e.b : e.a];
      return e.len >= Math.max(60, other.radius * 1.3);
    });
  }
  kept.forEach((e, i) => {
    e.id = i;
  });
  for (const nd of nodes) {
    nd.edges = [];
  }
  for (const e of kept) {
    nodes[e.a].edges.push(e.id);
    nodes[e.b].edges.push(e.id);
  }
  for (const nd of nodes) nd.dead = nd.edges.length === 1;
  return { nodes, edges: kept, paths };
}

function nearestNode(nodes: Node[], p: Pt): number {
  let best = 0;
  let bd = Infinity;
  for (const n of nodes) {
    const d = Math.hypot(n.x - p.x, n.y - p.y);
    if (d < bd) {
      bd = d;
      best = n.id;
    }
  }
  return best;
}

// ------------------------------------------------------------- simulation

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Curve {
  pts: Pt[];
  cum: number[];
  total: number;
  node: number;
  outEdge: number;
  outDir: 1 | -1;
  /** Distance along the out edge, from the node, where this curve ends. */
  exitS: number;
  scaleFrom: number;
  scaleTo: number;
  isU: boolean;
}

export interface Pose {
  x: number;
  y: number;
  angle: number;
  scale: number;
  active: boolean;
}

export type VehicleKind = "car" | "bike";

export interface Car extends Pose {
  id: number;
  /** Motorbikes/scooters: ~40% of a car's length, 15% faster, same lane, lock and gap rules. */
  kind: VehicleKind;
  edge: number;
  dir: 1 | -1;
  s: number;
  v: number;
  vDes: number;
  curve: Curve | null;
  curveS: number;
  /** Next edge picked when the car queued for the junction at the end of its edge. */
  plan: { node: number; outEdge: number; outDir: 1 | -1; queuedAt: number } | null;
  holding: number | null;
  /** True once the car has started its turn through the junction it holds. */
  entered: boolean;
  stuckFor: number;
}

interface Lock {
  holder: number | null;
  queue: number[];
}

export interface Sim {
  net: Network;
  rng: () => number;
  time: number;
  cars: Car[];
  locks: Lock[];
  /**
   * Asks the walker sim whether a pedestrian is crossing at this junction
   * (node id). Cars wait at the stop line while it answers true. Set by the
   * component that owns both sims; defaults to "nobody crossing".
   */
  pedCrossing: (nodeId: number) => boolean;
  maxCars: number;
  /** Seconds since any car last moved (gridlock detector). */
  stillFor: number;
  /** How many times the gridlock fallback had to re-place the cars (should stay 0). */
  resets: number;
}

const TURN_SPEED_FACTOR = 0.65;
// Minimum gap behind the vehicle ahead, as a fraction of the follower's OWN length
// (so a short bike keeps a proportionally shorter gap than a car).
const MIN_GAP_FRACTION = 0.1;
const BIKE_LENGTH_FACTOR = 0.4;
const BIKE_SPEED_FACTOR = 1.15;
const STOP_MARGIN = 16;
const ACCEL = 90;
const DECEL = 240;

function incidentDir(net: Network, edgeId: number, node: number): 1 | -1 {
  // direction of travel that LEAVES `node` along this edge
  return net.edges[edgeId].a === node ? 1 : -1;
}

function edgePoint(e: Edge, s: number, dir: 1 | -1): { p: Pt; t: Pt } {
  const ss = dir === 1 ? s : e.len - s;
  const r = pointAtArc(e.pts, e.cum, ss);
  return dir === 1 ? r : { p: r.p, t: { x: -r.t.x, y: -r.t.y } };
}

// Lateral point on an edge: `off` units to the LEFT of the direction of travel.
function lanePoint(e: Edge, s: number, dir: 1 | -1, off: number): { p: Pt; t: Pt } {
  const { p, t } = edgePoint(e, s, dir);
  const left = { x: t.y, y: -t.x };
  return { p: { x: p.x + left.x * off, y: p.y + left.y * off }, t };
}

function smooth(u: number) {
  const c = Math.max(0, Math.min(1, u));
  return c * c * (3 - 2 * c);
}

function buildCurve(
  net: Network,
  inEdge: number,
  inDir: 1 | -1,
  outEdge: number,
  outDir: 1 | -1,
  node: Node,
  offIn: number,
  offOut: number,
  scaleFrom: number,
  scaleTo: number,
): Curve {
  const ei = net.edges[inEdge];
  const eo = net.edges[outEdge];
  const tin = Math.min(node.radius + 2, ei.len * 0.45);
  const tout = Math.min(node.radius + 2, eo.len * 0.45);
  const A = lanePoint(ei, ei.len - tin, inDir, offIn);
  const B = lanePoint(eo, tout, outDir, offOut);
  const cr = cross(A.t, B.t);
  let C: Pt = { x: (A.p.x + B.p.x) / 2, y: (A.p.y + B.p.y) / 2 };
  if (Math.abs(cr) > 0.08) {
    const a = cross(sub(B.p, A.p), B.t) / cr;
    if (a > 0 && a < 4 * node.radius) C = { x: A.p.x + A.t.x * a, y: A.p.y + A.t.y * a };
  }
  const pts: Pt[] = [];
  const N = 18;
  for (let k = 0; k <= N; k++) {
    const u = k / N;
    const w0 = (1 - u) * (1 - u);
    const w1 = 2 * (1 - u) * u;
    const w2 = u * u;
    pts.push({ x: w0 * A.p.x + w1 * C.x + w2 * B.p.x, y: w0 * A.p.y + w1 * C.y + w2 * B.p.y });
  }
  const cum = cumulative(pts);
  return { pts, cum, total: cum[cum.length - 1], node: node.id, outEdge, outDir, exitS: tout, scaleFrom, scaleTo, isU: false };
}

function buildUTurn(net: Network, edgeId: number, dir: 1 | -1, off: number, scale: number, node: Node): Curve {
  const e = net.edges[edgeId];
  const fw = Math.min(1.6 * off + 8, e.len * 0.45);
  const base = edgePoint(e, e.len - fw, dir);
  const left = { x: base.t.y, y: -base.t.x };
  const pts: Pt[] = [];
  const N = 20;
  for (let k = 0; k <= N; k++) {
    const phi = (Math.PI * k) / N;
    pts.push({
      x: base.p.x + left.x * off * Math.cos(phi) + base.t.x * fw * Math.sin(phi),
      y: base.p.y + left.y * off * Math.cos(phi) + base.t.y * fw * Math.sin(phi),
    });
  }
  const cum = cumulative(pts);
  return { pts, cum, total: cum[cum.length - 1], node: node.id, outEdge: edgeId, outDir: dir === 1 ? -1 : 1, exitS: fw, scaleFrom: scale, scaleTo: scale, isU: true };
}

function curvePose(c: Curve, s: number): { p: Pt; t: Pt; u: number } {
  const r = pointAtArc(c.pts, c.cum, s);
  return { p: r.p, t: r.t, u: c.total ? s / c.total : 1 };
}

function setPose(o: Pose, p: Pt, t: Pt, scale: number) {
  o.x = p.x;
  o.y = p.y;
  o.angle = (Math.atan2(t.y, t.x) * 180) / Math.PI;
  o.scale = scale;
}

export interface SimOptions {
  seed: number;
  maxCars?: number;
}

export function createSim(net: Network, opts: SimOptions): Sim {
  const rng = mulberry32(opts.seed);
  const roadCount = new Set(net.edges.map((e) => e.roadId)).size;
  const maxCars = Math.min(opts.maxCars ?? 10, roadCount);
  const sim: Sim = {
    net,
    rng,
    time: 0,
    cars: [],
    locks: net.nodes.map(() => ({ holder: null, queue: [] })),
    pedCrossing: () => false,
    maxCars,
    stillFor: 0,
    resets: 0,
  };
  const usable = net.edges.filter((e) => e.len > 90);
  if (usable.length === 0) return sim;

  const pick = () => usable[Math.floor(rng() * usable.length)];
  const clear = (x: number, y: number, minD: number) =>
    sim.cars.every((c) => Math.hypot(c.x - x, c.y - y) >= minD);

  for (let n = 0; n < maxCars; n++) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const e = pick();
      const dir: 1 | -1 = rng() < 0.5 ? 1 : -1;
      const m = roadMetrics(e.width);
      const margin = net.nodes[e.a].radius + CAR_BASE_LENGTH * m.carScale + 6;
      const marginB = net.nodes[e.b].radius + CAR_BASE_LENGTH * m.carScale + 6;
      if (e.len < margin + marginB) continue;
      const s = margin + rng() * (e.len - margin - marginB);
      const pl = edgePoint(e, s, dir);
      const left = { x: pl.t.y, y: -pl.t.x };
      const x = pl.p.x + left.x * m.laneCenter;
      const y = pl.p.y + left.y * m.laneCenter;
      if (!clear(x, y, CAR_BASE_LENGTH * m.carScale * 2.4)) continue;
      const car: Car = {
        id: sim.cars.length,
        kind: sim.cars.length % 3 === 2 ? "bike" : "car",
        edge: e.id,
        dir,
        s,
        v: 0,
        vDes: (50 + rng() * 20) * (sim.cars.length % 3 === 2 ? BIKE_SPEED_FACTOR : 1),
        curve: null,
        curveS: 0,
        plan: null,
        holding: null,
        entered: false,
        stuckFor: 0,
        x,
        y,
        angle: 0,
        scale: m.carScale,
        active: true,
      };
      poseCar(sim, car);
      car.v = car.vDes * 0.6;
      sim.cars.push(car);
      break;
    }
  }

  return sim;
}


// Put every existing car back at a free spot (used only by the
// gridlock fallback). Mirrors the placement in createSim.
function respawn(sim: Sim) {
  const net = sim.net;
  const usable = net.edges.filter((e) => e.len > 90);
  if (usable.length === 0) return;
  const placed: { x: number; y: number }[] = [];
  const clear = (x: number, y: number, minD: number) => placed.every((q) => Math.hypot(q.x - x, q.y - y) >= minD);
  for (const c of sim.cars) {
    for (let attempt = 0; attempt < 60; attempt++) {
      const e = usable[Math.floor(sim.rng() * usable.length)];
      const dir: 1 | -1 = sim.rng() < 0.5 ? 1 : -1;
      const m = roadMetrics(e.width);
      const margin = net.nodes[e.a].radius + CAR_BASE_LENGTH * m.carScale + 6;
      const marginB = net.nodes[e.b].radius + CAR_BASE_LENGTH * m.carScale + 6;
      if (e.len < margin + marginB) continue;
      const s = margin + sim.rng() * (e.len - margin - marginB);
      c.edge = e.id;
      c.dir = dir;
      c.s = s;
      c.scale = m.carScale;
      poseCar(sim, c);
      if (!clear(c.x, c.y, CAR_BASE_LENGTH * m.carScale * 2.4)) continue;
      placed.push({ x: c.x, y: c.y });
      break;
    }
  }
}

function poseCar(sim: Sim, c: Car) {
  if (c.curve) {
    const r = curvePose(c.curve, c.curveS);
    setPose(c, r.p, r.t, c.curve.scaleFrom + (c.curve.scaleTo - c.curve.scaleFrom) * smooth(r.u));
    return;
  }
  const e = sim.net.edges[c.edge];
  const m = roadMetrics(e.width);
  const r = lanePoint(e, c.s, c.dir, m.laneCenter);
  setPose(c, r.p, r.t, m.carScale);
}

function distToEnd(sim: Sim, c: { edge: number; s: number }): number {
  return sim.net.edges[c.edge].len - c.s;
}

function vehLen(v: { scale: number; kind: VehicleKind }): number {
  return CAR_BASE_LENGTH * v.scale * (v.kind === "bike" ? BIKE_LENGTH_FACTOR : 1);
}

function minGapFor(v: { scale: number; kind: VehicleKind }): number {
  return Math.max(2, MIN_GAP_FRACTION * vehLen(v));
}

// Does the exit edge have room for one more car right after the junction?
function exitRoom(sim: Sim, outEdge: number, outDir: 1 | -1, need: number): boolean {
  return !sim.cars.some((o) => o.active && o.edge === outEdge && o.dir === outDir && !o.curve && o.s < need);
}

function planNext(sim: Sim, c: Car, nodeId: number): { outEdge: number; outDir: 1 | -1 } | null {
  const node = sim.net.nodes[nodeId];
  const options = node.edges.filter((id) => id !== c.edge);
  if (options.length === 0) return null;
  const outEdge = options[Math.floor(sim.rng() * options.length)];
  return { outEdge, outDir: incidentDir(sim.net, outEdge, nodeId) };
}

// Free road ahead of a car, measured ALONG its lane (not by geometry, so cars
// in the neighbouring lane or on a crossing road are never mistaken for a
// car in front). A car on an edge looks at cars ahead on the same edge and
// direction; a car in a turn looks at cars already on the road it is turning
// into. Anything beyond the junction is handled by the junction lock.
function aheadOf(sim: Sim, c: Car): { gap: number; v: number } | null {
  const L = vehLen(c);
  let best: { gap: number; v: number } | null = null;
  const consider = (gap: number, o: Car) => {
    if (!best || gap < best.gap) best = { gap, v: o.v };
  };
  for (const o of sim.cars) {
    if (o === c || !o.active) continue;
    const Lo = vehLen(o);
    if (c.curve) {
      if (!o.curve && o.edge === c.curve.outEdge && o.dir === c.curve.outDir) {
        consider(c.curve.total - c.curveS + (o.s - c.curve.exitS) - (L + Lo) / 2, o);
      }
    } else if (o.edge === c.edge && o.dir === c.dir) {
      const os = o.curve ? o.s + o.curveS : o.s;
      if (os > c.s) consider(os - c.s - (L + Lo) / 2, o);
    }
  }
  return best;
}

export function stepSim(sim: Sim, dtIn: number) {
  const dt = Math.min(0.05, Math.max(0, dtIn));
  if (dt === 0) return;
  sim.time += dt;
  const net = sim.net;

  // ---- cars ----
  for (const c of sim.cars) {
    if (!c.active) continue;
    const e = net.edges[c.edge];
    const m = roadMetrics(e.width);
    const L = vehLen(c);
    let target = c.vDes;

    if (c.curve) {
      target = c.vDes * (c.curve.isU ? 0.5 : TURN_SPEED_FACTOR);
    } else {
      const endNode = net.nodes[c.dir === 1 ? e.b : e.a];
      const dEnd = distToEnd(sim, c);
      if (!endNode.dead) {
        const lock = sim.locks[endNode.id];
        // Stop line: outside the junction, plus a margin so a waiting car's
        // nose never touches a car swinging through the turn.
        const stopDist = endNode.radius + L / 2 + STOP_MARGIN;
        const brake = (c.v * c.v) / (2 * DECEL) + 12;
        if (c.holding !== endNode.id && dEnd <= stopDist + brake + 4) {
          if (!c.plan || c.plan.node !== endNode.id) {
            const nx = planNext(sim, c, endNode.id);
            if (nx) {
              c.plan = { node: endNode.id, outEdge: nx.outEdge, outDir: nx.outDir, queuedAt: sim.time };
              lock.queue.push(c.id);
            }
          }
          if (c.plan) {
            const ready =
              lock.holder === null &&
              lock.queue[0] === c.id &&
              !sim.pedCrossing(endNode.id) &&
              exitRoom(sim, c.plan.outEdge, c.plan.outDir, L + minGapFor(c) + 10);
            if (ready) {
              lock.holder = c.id;
              lock.queue = lock.queue.filter((id) => id !== c.id);
              c.holding = endNode.id;
            } else {
              const room = Math.max(0, dEnd - stopDist);
              target = Math.min(target, Math.sqrt(2 * DECEL * 0.8 * room));
            }
          }
        }
      }
    }

    // keep a gap behind the car in front
    const ahead = aheadOf(sim, c);
    if (ahead && ahead.gap < minGapFor(c) + (c.v * c.v) / (2 * DECEL) + 14) {
      const room = Math.max(0, ahead.gap - minGapFor(c));
      target = Math.min(target, Math.sqrt(2 * DECEL * 0.8 * room), ahead.v + room * 1.5);
    }

    if (target > c.v) c.v = Math.min(target, c.v + ACCEL * dt);
    else c.v = Math.max(target, c.v - DECEL * dt);
    c.stuckFor = c.v < 1 ? c.stuckFor + dt : 0;
    advanceCar(sim, c, c.v * dt, m);
  }

  // release the lock of a car that has driven through and cleared its junction
  for (const c of sim.cars) {
    if (c.holding === null || !c.active) continue;
    const node = net.nodes[c.holding];
    const e = net.edges[c.edge];
    const headingInto = (c.dir === 1 ? e.b : e.a) === c.holding;
    if (c.entered && !c.curve && (headingInto || Math.hypot(c.x - node.x, c.y - node.y) > node.radius + vehLen(c) / 2)) {
      const lk = sim.locks[c.holding];
      if (lk.holder === c.id) lk.holder = null;
      c.holding = null;
      c.entered = false;
    }
  }
  for (let i = 0; i < sim.locks.length; i++) {
    const lk = sim.locks[i];
    lk.queue = lk.queue.filter((id) => sim.cars[id].active && sim.cars[id].plan?.node === i && sim.cars[id].holding !== i);
  }

  // Last resort against a permanent gridlock (should never trigger): if no
  // active car has moved for a long time, put every car back at a fresh
  // spot with all locks cleared.
  const anyCar = sim.cars.some((c) => c.active);
  const moving = sim.cars.some((c) => c.active && c.v > 1);
  sim.stillFor = moving || !anyCar ? 0 : sim.stillFor + dt;
  if (sim.stillFor > 25) {
    sim.resets++;
    sim.stillFor = 0;
    for (const lk of sim.locks) {
      lk.holder = null;
      lk.queue = [];
    }
    for (const c of sim.cars) {
      c.holding = null;
      c.plan = null;
      c.curve = null;
      c.entered = false;
      c.v = 0;
      c.stuckFor = 0;
    }
    respawn(sim);
  }
}

function advanceCar(sim: Sim, c: Car, dist: number, m: ReturnType<typeof roadMetrics>) {
  const net = sim.net;
  if (c.curve) {
    c.curveS += dist;
    if (c.curveS >= c.curve.total) {
      const cv = c.curve;
      c.edge = cv.outEdge;
      c.dir = cv.outDir;
      c.s = cv.exitS + (c.curveS - cv.total);
      c.curve = null;
      c.curveS = 0;
      c.plan = null;
    }
    poseCar(sim, c);
    return;
  }
  const e = net.edges[c.edge];
  const endNode = net.nodes[c.dir === 1 ? e.b : e.a];
  c.s += dist;
  if (endNode.dead) {
    const fw = Math.min(1.6 * m.laneCenter + 8, e.len * 0.45);
    if (c.s >= e.len - fw) {
      const cv = buildUTurn(net, c.edge, c.dir, m.laneCenter, m.carScale, endNode);
      c.curve = cv;
      c.curveS = c.s - (e.len - fw);
      poseCar(sim, c);
      return;
    }
  } else if (c.plan && c.holding === endNode.id) {
    const tin = Math.min(endNode.radius + 2, e.len * 0.45);
    if (c.s >= e.len - tin) {
      const eo = net.edges[c.plan.outEdge];
      const mo = roadMetrics(eo.width);
      const cv = buildCurve(net, c.edge, c.dir, c.plan.outEdge, c.plan.outDir, endNode, m.laneCenter, mo.laneCenter, m.carScale, mo.carScale);
      c.curve = cv;
      c.curveS = c.s - (e.len - tin);
      c.entered = true;
      poseCar(sim, c);
      return;
    }
  }
  if (c.s > e.len) c.s = e.len;
  poseCar(sim, c);
}

// Deactivate the most recently added active car (used when frames run slow).
export function removeOneCar(sim: Sim): boolean {
  for (let i = sim.cars.length - 1; i >= 0; i--) {
    const c = sim.cars[i];
    if (!c.active) continue;
    c.active = false;
    if (c.holding !== null && sim.locks[c.holding].holder === c.id) sim.locks[c.holding].holder = null;
    return true;
  }
  return false;
}

export function activeCars(sim: Sim): number {
  return sim.cars.filter((c) => c.active).length;
}

/**
 * The road network as the walker sim wants it: every edge a STRAIGHT piece
 * between two nodes. Curved roads are split at their bend points, which
 * become extra degree-2 nodes (ids "e<edge>p<index>") that walkers simply
 * walk through. Node ids for real junctions are the traffic node ids as text,
 * so the car sim and the walker sim can talk about the same junction.
 *
 * Edge width is the road width minus the two white edge lines, so the footpath
 * the walker sim derives (10% of that width, hugging the edge) lands on the
 * pavement strip drawn by the road layer.
 */
export function buildWalkGraph(net: Network): { nodes: WalkNode[]; edges: WalkEdge[] } {
  const nodes: WalkNode[] = net.nodes.map((n) => ({ id: String(n.id), x: n.x, y: n.y }));
  const edges: WalkEdge[] = [];
  // Perimeter roads: their outer side faces the grass, so only the inner
  // footpath exists. A side is "outer" when a point one half-width out from
  // the centre line falls outside the box spanned by all road centre lines.
  const all = net.edges.flatMap((e) => e.pts);
  const lo = { x: Math.min(...all.map((p) => p.x)), y: Math.min(...all.map((p) => p.y)) };
  const hi = { x: Math.max(...all.map((p) => p.x)), y: Math.max(...all.map((p) => p.y)) };
  const outside = (p: Pt) => p.x < lo.x - 1 || p.x > hi.x + 1 || p.y < lo.y - 1 || p.y > hi.y + 1;
  for (const e of net.edges) {
    const width = Math.max(1, e.width - 2 * (EDGE_INSET + EDGE_LINE));
    let prev = String(e.a);
    for (let i = 1; i < e.pts.length; i++) {
      const a = e.pts[i - 1];
      const b = e.pts[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const left = { x: (b.y - a.y) / len, y: -(b.x - a.x) / len };
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const probe = (side: 1 | -1) => ({ x: mid.x + left.x * side * e.width * 0.5, y: mid.y + left.y * side * e.width * 0.5 });
      const leftOut = outside(probe(1));
      const rightOut = outside(probe(-1));
      const onlySide: 1 | -1 | undefined = leftOut && !rightOut ? -1 : rightOut && !leftOut ? 1 : undefined;
      const last = i === e.pts.length - 1;
      let id: string;
      if (last) id = String(e.b);
      else {
        id = `e${e.id}p${i}`;
        nodes.push({ id, x: e.pts[i].x, y: e.pts[i].y });
      }
      edges.push({ id: `e${e.id}s${i}`, a: prev, b: id, width, onlySide });
      prev = id;
    }
  }
  return { nodes, edges };
}

// Midpoint and direction of an edge (used to place a road's width label on
// its longest stretch, away from junctions).
export function edgeMidpoint(e: Edge): { p: Pt; t: Pt } {
  return pointAtArc(e.pts, e.cum, e.len / 2);
}
