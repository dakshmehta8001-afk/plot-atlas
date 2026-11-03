// Road network for the public site map: junctions, road ends and edges, and
// the streetlight positions. Pure code (no React/DOM). It does one job:
//
//  1. connectRoads(): roads are stored as independent centre lines that
//     often stop just short of each other (a vertical road ends ~50 units
//     below the road it should meet). This finds the junctions, extends
//     (or trims) road ENDS so roads physically meet, and splits roads into
//     graph edges between junction nodes. It changes only what is DRAWN —
//     the saved road data is never touched. A road end is only snapped when
//     the gap is within one road width, so a road meant to end stays a dead
//     end.
//

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

/** Id of the synthetic road that is the gate's approach road (outside the wall). */
export const GATE_ROAD_ID = "__gate__";

export interface Network {
  nodes: Node[];
  edges: Edge[];
  /**
   * The entry gate, if the project has one: the approach edge, the junction
   * where it meets the perimeter road, and its far (outside) end. Vehicles
   * enter and leave the site through it. Null when there is no gate.
   */
  gate: { edge: number; junction: number; outer: number } | null;
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
  // Also cut the stub off the DRAWN road. A road that runs on past a junction
  // leaves a square-ended piece sticking out beyond the corner; trimming it to
  // the junction lets the rounded corner fillet cover the outside of the bend
  // instead. (The junction's own asphalt still covers the cut end.)
  for (const e of edges) {
    if (kept.includes(e)) continue;
    const P = paths.get(e.roadId);
    if (!P || P.length < 2) continue;
    const used = (n: number) => kept.some((k) => k.a === n || k.b === n);
    const ends: [number, number][] = [[e.a, e.b], [e.b, e.a]]; // [dead end, junction]
    for (const [dead, junction] of ends) {
      if (used(dead) || !used(junction)) continue;
      const jn = nodes[junction];
      const cumP = cumulative(P);
      const sJ = nearestOnPath(P, jn).s;
      const atEnd = Math.hypot(P[P.length - 1].x - nodes[dead].x, P[P.length - 1].y - nodes[dead].y) <= MERGE_TOL + 5;
      const atStart = Math.hypot(P[0].x - nodes[dead].x, P[0].y - nodes[dead].y) <= MERGE_TOL + 5;
      if (atEnd && sJ < cumP[cumP.length - 1] - 1) {
        const keep = P.filter((_, i) => cumP[i] < sJ - 1);
        paths.set(e.roadId, [...keep, { x: jn.x, y: jn.y }]);
      } else if (atStart && sJ > 1) {
        const keep = P.filter((_, i) => cumP[i] > sJ + 1);
        paths.set(e.roadId, [{ x: jn.x, y: jn.y }, ...keep]);
      }
      break;
    }
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
  // The gate's approach edge: a dead end outside, joined to the site's road.
  let gate: Network["gate"] = null;
  const ge = kept.find((e) => e.roadId === GATE_ROAD_ID);
  if (ge) {
    const aDead = nodes[ge.a].edges.length === 1;
    const bDead = nodes[ge.b].edges.length === 1;
    if (aDead !== bDead) gate = { edge: ge.id, junction: aDead ? ge.b : ge.a, outer: aDead ? ge.a : ge.b };
  }
  return { nodes, edges: kept, paths, gate };
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

export interface Streetlight {
  /** Pole position (on the kerb, just inside the white edge line). */
  x: number;
  y: number;
  /** Where the lamp hangs: the end of the short arm reaching over the road. */
  ax: number;
  ay: number;
}

/**
 * Streetlight poles along the INNER edge of every road (the side facing the
 * plots; on a road with plots on both sides, one fixed side), about one every
 * `spacing` map units, spread evenly between the junctions. Poles are skipped
 * inside junctions, and none are placed on the gate's approach road.
 */
export function buildStreetlights(net: Network, spacing: number): Streetlight[] {
  const real = net.edges.filter((e) => e.roadId !== GATE_ROAD_ID);
  if (real.length === 0 || !(spacing > 0)) return [];
  const all = real.flatMap((e) => e.pts);
  const lo = { x: Math.min(...all.map((p) => p.x)), y: Math.min(...all.map((p) => p.y)) };
  const hi = { x: Math.max(...all.map((p) => p.x)), y: Math.max(...all.map((p) => p.y)) };
  const outside = (p: Pt) => p.x < lo.x - 1 || p.x > hi.x + 1 || p.y < lo.y - 1 || p.y > hi.y + 1;
  const lights: Streetlight[] = [];
  for (const e of real) {
    const from = net.nodes[e.a].radius + 8;
    const to = e.len - net.nodes[e.b].radius - 8;
    if (to - from < 24) continue;
    const count = Math.max(1, Math.round((to - from) / spacing));
    for (let i = 0; i < count; i++) {
      const s = from + ((i + 0.5) * (to - from)) / count;
      const { p, t } = pointAtArc(e.pts, e.cum, s);
      const left = { x: t.y, y: -t.x };
      const probe = (side: number) => ({ x: p.x + left.x * side * (e.width / 2 + 2), y: p.y + left.y * side * (e.width / 2 + 2) });
      // The inner side is the one that is NOT outside the site's road box.
      const side = outside(probe(1)) && !outside(probe(-1)) ? -1 : 1;
      const kerb = e.width / 2 - (EDGE_INSET + EDGE_LINE) - 1.5;
      const arm = Math.min(e.width * 0.22, 26);
      const pole = { x: p.x + left.x * side * kerb, y: p.y + left.y * side * kerb };
      lights.push({ x: pole.x, y: pole.y, ax: pole.x - left.x * side * arm, ay: pole.y - left.y * side * arm });
    }
  }
  return lights;
}

// Midpoint and direction of an edge (used to place a road's width label on
// its longest stretch, away from junctions).
export function edgeMidpoint(e: Edge): { p: Pt; t: Pt } {
  return pointAtArc(e.pts, e.cum, e.len / 2);
}
