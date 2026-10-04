// Walker simulation for the public site map.
// Pure logic, no React or DOM, so it can be unit-tested in plain Node.
//
// Walkers move on footpaths (pale strips just inside each road edge),
// turn corners on their own side, and cross a road ONLY at a junction:
//   - straight on across a side road's mouth
//   - turn the corner on their own side (no road crossing)
//   - cross to the other footpath and walk back (U-turn)
//   - dead end: always U-turn
// Before any crossing they wait while a car occupies that junction.
// Cars can ask isCrossing(nodeId) to wait for walkers too.
//
// Input graph: each edge is a STRAIGHT piece of road between two nodes.
// Curved roads should be split into straight pieces joined by degree-2
// nodes; walkers just carry straight on through those.
// Units are map units (same as mapScenery.ts). Screen y points down.

export interface Pt {
  x: number;
  y: number;
}

export interface WalkNode {
  id: string;
  x: number;
  y: number;
}

export interface WalkEdge {
  id: string;
  a: string; // node id
  b: string; // node id
  width: number; // full road width in map units
  /** If set, only this footpath exists (+1 = left of a->b, -1 = right): used on perimeter roads, whose outer side is grass. */
  onlySide?: 1 | -1;
}

export interface WalkerPose {
  x: number;
  y: number;
  angle: number; // degrees, direction of travel
  scale: number; // sprite scale, fitted to this road's footpath
  walking: boolean; // false while paused or waiting (use for a still frame)
}

export interface WalkerSimOptions {
  count: number;
  seed?: number;
  speed?: number; // map units per second, default 14
  pavementRatio?: number; // footpath width as a share of road width, default 0.14
  spriteWidth?: number; // walker sprite width at scale 1, default 10
  isJunctionBusy?: (nodeId: string) => boolean; // from the car sim
}

// ---------- internals ----------

interface Edge extends WalkEdge {
  ax: number;
  ay: number;
  len: number;
  ux: number; // unit vector a -> b
  uy: number;
  pave: number; // footpath width
}

interface Node extends WalkNode {
  edges: Edge[];
}

type Mode = "walk" | "pause" | "wait" | "move";

interface Pending {
  edge: Edge;
  side: 1 | -1;
  dir: 1 | -1;
  s: number;
}

interface Walker {
  edge: Edge;
  side: 1 | -1; // +1 = left of a->b, -1 = right
  dir: 1 | -1; // +1 = towards b, -1 = towards a
  s: number; // distance from a along the edge
  speed: number;
  lane: number; // -1..1, small sideways offset so walkers don't stack
  mode: Mode;
  timer: number; // pause time left
  path: Pt[] | null; // transition path (corner, crossing)
  cum: number[]; // cumulative lengths along path
  t: number; // distance travelled along path
  pending: Pending | null; // where the walker ends up after the path
  node: string | null; // junction being crossed or waited at
  scaleFrom: number;
  scaleTo: number;
  pose: WalkerPose;
}

// Seeded random numbers (mulberry32), so every page load looks the same.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Left-hand normal of a direction, for screen coordinates (y down).
const leftOf = (x: number, y: number) => ({ x: y, y: -x });
const dot = (ax: number, ay: number, bx: number, by: number) => ax * bx + ay * by;

export class WalkerSim {
  private nodes = new Map<string, Node>();
  private walkers: Walker[] = [];
  private rand: () => number;
  private opts: Required<Omit<WalkerSimOptions, "isJunctionBusy">> & Pick<WalkerSimOptions, "isJunctionBusy">;

  constructor(nodes: WalkNode[], edges: WalkEdge[], options: WalkerSimOptions) {
    this.opts = {
      seed: 7,
      speed: 14,
      pavementRatio: 0.14,
      spriteWidth: 10,
      ...options,
    };
    this.rand = rng(this.opts.seed);

    for (const n of nodes) this.nodes.set(n.id, { ...n, edges: [] });
    for (const e of edges) {
      const A = this.nodes.get(e.a);
      const B = this.nodes.get(e.b);
      if (!A || !B || e.a === e.b) continue;
      const dx = B.x - A.x;
      const dy = B.y - A.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      const edge: Edge = {
        ...e,
        ax: A.x,
        ay: A.y,
        len,
        ux: dx / len,
        uy: dy / len,
        pave: e.width * this.opts.pavementRatio,
      };
      A.edges.push(edge);
      B.edges.push(edge);
    }
    this.spawn();
  }

  /** Current poses, one per walker, in a stable order. */
  get poses(): readonly WalkerPose[] {
    return this.walkers.map((w) => w.pose);
  }

  /** True while a walker is crossing at this junction (cars should wait). */
  isCrossing(nodeId: string): boolean {
    return this.walkers.some((w) => w.mode === "move" && w.node === nodeId);
  }

  /** Advance the simulation. dt in seconds; cap it in the caller (e.g. 0.05). */
  step(dt: number): void {
    for (const w of this.walkers) this.stepWalker(w, dt);
  }

  // ---------- geometry helpers ----------

  private scaleFor(e: Edge): number {
    return (e.pave * 0.9) / this.opts.spriteWidth;
  }

  // How far back from a node the footpath stops, so walkers wait at the
  // junction edge instead of walking into the middle of it.
  private setback(e: Edge, nodeId: string): number {
    const n = this.nodes.get(nodeId)!;
    if (n.edges.length === 1) return e.pave * 0.6; // dead end
    let half = 0;
    for (const o of n.edges) if (o !== e) half = Math.max(half, o.width / 2);
    return half + e.pave * 0.5;
  }

  private range(e: Edge): [number, number] {
    const lo = this.setback(e, e.a);
    const hi = e.len - this.setback(e, e.b);
    if (hi > lo) return [lo, hi];
    const mid = e.len / 2;
    return [mid, mid]; // very short piece: walkers pass straight through
  }

  private footPoint(e: Edge, s: number, side: 1 | -1, lane: number): Pt {
    const n = leftOf(e.ux, e.uy);
    const off = e.width / 2 - e.pave / 2 + lane * e.pave * 0.25;
    return {
      x: e.ax + e.ux * s + n.x * off * side,
      y: e.ay + e.uy * s + n.y * off * side,
    };
  }

  // ---------- setup ----------

  private spawn(): void {
    const all: Edge[] = [];
    for (const n of this.nodes.values()) for (const e of n.edges) if (!all.includes(e)) all.push(e);
    const usable = all.filter((e) => {
      const [lo, hi] = this.range(e);
      return hi > lo;
    });
    if (usable.length === 0) return;
    const total = usable.reduce((sum, e) => sum + e.len, 0);

    for (let i = 0; i < this.opts.count; i++) {
      // Pick an edge weighted by length, so long roads get more walkers.
      let r = this.rand() * total;
      let edge = usable[0];
      for (const e of usable) {
        r -= e.len;
        if (r <= 0) {
          edge = e;
          break;
        }
      }
      const [lo, hi] = this.range(edge);
      const w: Walker = {
        edge,
        side: edge.onlySide ?? (this.rand() < 0.5 ? 1 : -1),
        dir: this.rand() < 0.5 ? 1 : -1,
        s: lo + this.rand() * (hi - lo),
        speed: this.opts.speed * (0.8 + this.rand() * 0.5),
        lane: this.rand() * 2 - 1,
        mode: "walk",
        timer: 0,
        path: null,
        cum: [],
        t: 0,
        pending: null,
        node: null,
        scaleFrom: this.scaleFor(edge),
        scaleTo: this.scaleFor(edge),
        pose: { x: 0, y: 0, angle: 0, scale: this.scaleFor(edge), walking: true },
      };
      this.placeOnEdge(w);
      this.walkers.push(w);
    }
  }

  private placeOnEdge(w: Walker): void {
    const p = this.footPoint(w.edge, w.s, w.side, w.lane);
    w.pose.x = p.x;
    w.pose.y = p.y;
    w.pose.angle = (Math.atan2(w.edge.uy * w.dir, w.edge.ux * w.dir) * 180) / Math.PI;
    w.pose.scale = this.scaleFor(w.edge);
  }

  // ---------- per-frame update ----------

  private stepWalker(w: Walker, dt: number): void {
    if (w.mode === "pause") {
      w.pose.walking = false;
      w.timer -= dt;
      if (w.timer <= 0) w.mode = "walk";
      return;
    }

    if (w.mode === "wait") {
      w.pose.walking = false;
      if (!this.opts.isJunctionBusy?.(w.node!)) w.mode = "move";
      return;
    }

    w.pose.walking = true;

    if (w.mode === "move") {
      w.t += w.speed * dt;
      const total = w.cum[w.cum.length - 1];
      if (w.t >= total) {
        const p = w.pending!;
        w.edge = p.edge;
        w.side = p.side;
        w.dir = p.dir;
        w.s = p.s;
        w.path = null;
        w.pending = null;
        w.node = null;
        w.mode = "walk";
        this.placeOnEdge(w);
        return;
      }
      this.poseOnPath(w, w.t / total);
      return;
    }

    // Walking along a footpath. Slow down behind a slower walker ahead.
    const v = this.followSpeed(w);
    const [lo, hi] = this.range(w.edge);
    w.s += w.dir * v * dt;

    // Now and then stop for a moment, like a real person.
    if (this.rand() < 0.02 * dt) {
      w.mode = "pause";
      w.timer = 1 + this.rand() * 2;
    }

    if ((w.dir === 1 && w.s >= hi) || (w.dir === -1 && w.s <= lo)) {
      w.s = w.dir === 1 ? hi : lo;
      this.placeOnEdge(w);
      this.decide(w);
      return;
    }
    this.placeOnEdge(w);
  }

  private followSpeed(w: Walker): number {
    let v = w.speed;
    const gap = w.pose.scale * this.opts.spriteWidth * 1.6;
    for (const o of this.walkers) {
      if (o === w || o.mode === "move" || o.edge !== w.edge || o.side !== w.side || o.dir !== w.dir) continue;
      const ahead = (o.s - w.s) * w.dir;
      if (ahead > 0 && ahead < gap) v = Math.min(v, o.mode === "walk" ? o.speed : 0);
    }
    return v;
  }

  private poseOnPath(w: Walker, f: number): void {
    const path = w.path!;
    const target = f * w.cum[w.cum.length - 1];
    let i = 1;
    while (i < w.cum.length - 1 && w.cum[i] < target) i++;
    const segLen = w.cum[i] - w.cum[i - 1] || 1;
    const k = (target - w.cum[i - 1]) / segLen;
    const a = path[i - 1];
    const b = path[i];
    w.pose.x = a.x + (b.x - a.x) * k;
    w.pose.y = a.y + (b.y - a.y) * k;
    w.pose.angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    w.pose.scale = w.scaleFrom + (w.scaleTo - w.scaleFrom) * f;
  }

  // ---------- junction decisions ----------

  private decide(w: Walker): void {
    const e = w.edge;
    const nodeId = w.dir === 1 ? e.b : e.a;
    const node = this.nodes.get(nodeId)!;
    const vin = { x: e.ux * w.dir, y: e.uy * w.dir };
    const left = leftOf(vin.x, vin.y);
    const relLeft = (w.side * w.dir) as 1 | -1; // +1 = walker is on its own left
    const P0 = { x: w.pose.x, y: w.pose.y };

    type Option = { weight: number; build: () => void };
    const options: Option[] = [];

    for (const f of node.edges) {
      if (f === e) continue;
      const out: 1 | -1 = f.a === nodeId ? 1 : -1;
      const u = { x: f.ux * out, y: f.uy * out };
      const straight = dot(u.x, u.y, vin.x, vin.y);
      const turn = dot(u.x, u.y, left.x, left.y);
      const newSide = (relLeft * out) as 1 | -1;
      const [lo, hi] = this.range(f);
      const s = out === 1 ? lo : hi;
      const P2 = this.footPoint(f, s, newSide, w.lane);
      if (f.onlySide !== undefined && f.onlySide !== newSide) continue; // that footpath is not there
      const pending: Pending = { edge: f, side: newSide, dir: out, s };

      if (straight > 0.7) {
        // Straight on. Crosses a side road's mouth if the junction has one.
        const crosses = node.edges.length > 2;
        options.push({
          weight: 0.45,
          build: () => this.start(w, [P0, P2], pending, crosses ? nodeId : null, f),
        });
      } else if (Math.sign(turn) === relLeft && Math.abs(turn) > 0.5) {
        // Turn the corner on the walker's own side: no road to cross.
        const C = intersect(P0, vin, P2, u) ?? { x: (P0.x + P2.x) / 2, y: (P0.y + P2.y) / 2 };
        options.push({
          weight: 0.35,
          build: () => this.start(w, bezier(P0, C, P2, 8), pending, null, f),
        });
      }
    }

    // Cross to the other footpath and walk back (also the dead-end move).
    const uturn = () => {
      // With only one footpath, turn round on it (nothing to cross).
      const single = e.onlySide !== undefined;
      const side = single ? w.side : (-w.side as 1 | -1);
      const P2 = this.footPoint(e, w.s, side, w.lane);
      this.start(w, [P0, P2], { edge: e, side, dir: -w.dir as 1 | -1, s: w.s }, single ? null : nodeId, e);
    };
    options.push({ weight: options.length === 0 ? 1 : 0.2, build: uturn });

    const total = options.reduce((sum, o) => sum + o.weight, 0);
    let r = this.rand() * total;
    for (const o of options) {
      r -= o.weight;
      if (r <= 0) return o.build();
    }
    options[options.length - 1].build();
  }

  private start(w: Walker, path: Pt[], pending: Pending, crossingNode: string | null, toEdge: Edge): void {
    w.path = path;
    w.cum = [0];
    for (let i = 1; i < path.length; i++) {
      w.cum.push(w.cum[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
    }
    if (w.cum[w.cum.length - 1] < 1e-6) w.cum[w.cum.length - 1] = 1e-6;
    w.t = 0;
    w.pending = pending;
    w.node = crossingNode;
    w.scaleFrom = this.scaleFor(w.edge);
    w.scaleTo = this.scaleFor(toEdge);
    // Crossing a road: wait while a car is in the junction.
    w.mode = crossingNode && this.opts.isJunctionBusy?.(crossingNode) ? "wait" : "move";
  }
}

// Where two lines (point + direction) meet; null if nearly parallel.
function intersect(p: Pt, d: Pt, q: Pt, e: Pt): Pt | null {
  const den = d.x * e.y - d.y * e.x;
  if (Math.abs(den) < 1e-6) return null;
  const t = ((q.x - p.x) * e.y - (q.y - p.y) * e.x) / den;
  return { x: p.x + d.x * t, y: p.y + d.y * t };
}

function bezier(a: Pt, c: Pt, b: Pt, steps: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const m = 1 - t;
    pts.push({
      x: m * m * a.x + 2 * m * t * c.x + t * t * b.x,
      y: m * m * a.y + 2 * m * t * c.y + t * t * b.y,
    });
  }
  return pts;
}
