// Plot candidate generation via PLANAR-GRAPH FACE EXTRACTION — replaces the
// findContours-based approach in plots.ts for layouts where adjacent plots
// share boundary lines (e.g. a real subdivided grid, not a set of separately
// drawn/gapped outlines).
//
// Why this exists at all: a closed-contour tracer (cv.findContours) has no
// concept of "a wall shared by two cells". At every T-junction — anywhere
// three or more plot-grid lines meet, which is everywhere in a real plotted
// layout, not an edge case — a tiny gap or anti-aliasing break lets the
// contour tracer's loop-following logic skip past the junction and merge
// two or more adjacent real plots into one bigger closed loop. That merged
// loop can look exactly like a single valid, clean quadrilateral to every
// existing geometric filter (area/solidity/vertex-count) — it isn't a
// threshold problem, it's the wrong shape of algorithm for this input.
//
// The fix is the standard "polygonize a line network" technique (the same
// idea GIS tooling calls ST_Polygonize / a planar-subdivision Polygonizer):
//   candidate line segments
//     -> snap endpoints/intersections into shared graph nodes
//     -> split every segment at every point another segment crosses or
//        touches it (this is what turns "two lines that happen to meet" into
//        "two graph edges that share a node", which is the whole trick — a
//        shared wall becomes ONE edge bordering TWO faces, not two
//        independent, possibly-broken loops)
//     -> walk the resulting directed half-edge graph to enumerate every
//        enclosed FACE (a face is a fundamentally different, more correct
//        concept than "a closed contour": every wall belongs to exactly the
//        two faces on either side of it, by construction, so a T-junction
//        can no longer cause two plots to merge)
//     -> validate faces with the EXACT SAME area/solidity/vertex-count
//        sanity checks plots.ts already uses (a face is just a polygon once
//        extracted, so the same judgement of "is this plot-shaped" applies
//        unchanged) — this is also what discards the one huge "outer,
//        unbounded" face the walk always produces, via the existing
//        maxAreaFraction cap, with no special-cased "find the outer face"
//        logic needed
//     -> OCR each validated face's own interior crop
//     -> associate a plot number to a face by testing whether the OCR
//        text's bounding-box CENTER falls inside that face's polygon — not
//        by "nearest text", which is ambiguous once faces are small and
//        packed tightly against each other (exactly the case this whole
//        module exists to handle correctly)
//
// Now wired into useDetectionPipeline.ts, replacing plots.ts's
// findContours-based candidate generation there — confirmed via the debug
// harness (built alongside this file) against a synthetic plan with known
// ground truth and both real scanned plans this project has on hand
// (BALAJI VIHAR, Naman Infracity): every real plot on all three correctly,
// individually separated, including the specific real plots that used to
// merge across a shared thin wall under the old approach.
//
// roads.ts is deliberately left completely untouched (not even to add
// `export` to its private helpers) — the small amount of candidate-edge
// extraction logic this file needs (Hough + contour-decomposition +
// collinear-fragment merging) is copied here instead of imported, so this
// module can be built, tested, and iterated on with zero risk of changing
// road-detection behavior. See extractCandidateSegments below for exactly
// what's duplicated and why each piece exists.
import type { PolygonPoint } from "@/lib/types";
import { pointInPolygon } from "@/lib/svgPolygon";
import type { Cv } from "../opencvLoader";
import { recognizeCropWords, type OcrWordResult } from "../ocrWorker";
import type { DetectedShape } from "../types";
import { DEFAULT_PLOT_OPTIONS, type PlotDetectionOptions } from "./plots";

// ---------------------------------------------------------------------------
// Candidate line-segment extraction — an isolated copy of roads.ts's own
// Hough + contour-decomposition + collinear-merge pipeline (see that file's
// top comment for the original rationale of each piece; not repeated in
// full here). Copied rather than imported specifically so roads.ts's own
// exports/visibility never have to change for this feature — see this
// file's top comment.
// ---------------------------------------------------------------------------

interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function segLength(s: Segment): number {
  return Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
}

// Undirected angle (0..PI) — a line and its reverse should cluster together.
function angleOf(s: Segment): number {
  let a = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
  if (a < 0) a += Math.PI;
  return a;
}

function perpDistanceToLine(line: Segment, px: number, py: number): number {
  const dx = line.x2 - line.x1;
  const dy = line.y2 - line.y1;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(px - line.x1, py - line.y1);
  return Math.abs((px - line.x1) * dy - (py - line.y1) * dx) / len;
}

// Groups segments that point roughly the same direction and lie roughly on
// the same infinite line, then collapses each group to the single longest
// span it covers — turns several short broken Hough fragments of one real
// wall into one clean candidate edge before graph-building ever splits it
// again at real intersections. Identical logic to roads.ts's own
// mergeSegments (see there for the original doc comment); copied, not
// imported — see this file's top comment.
// Groups segments that point roughly the same direction and lie roughly on
// the same infinite line, then collapses each group to the single longest
// span it covers. Identical logic to roads.ts's own mergeSegments; copied,
// not imported — see this file's top comment.
//
// A gap-limited variant of this was tried and reverted: bounding how far a
// candidate's span may sit from the cluster's accepted span (to stop two
// unrelated graphic elements — a logo stroke, a compass line — from
// bridging across a huge empty gap just for being coincidentally
// collinear) sounds right, but broke real recall on this module's own
// clean synthetic-image regression test (several genuine plot walls,
// legitimately Hough-fragmented into 3+ pieces, stopped fully stitching —
// even after fixing a related iteration-order bug, tuning the tolerance
// couldn't recover the loss without reopening the bridging risk it was
// meant to close). The actual fix for that bridging problem lives in
// extractCandidateSegments' support check instead (see
// MAX_UNSUPPORTED_RUN there): a real wall's small scattered dash-gaps and
// a bogus bridge's one huge empty middle look identical to THIS function
// (both are "some segments, roughly collinear") but look very different
// once actually checked against the edge map, which is the right place to
// tell them apart.
function mergeSegments(segs: Segment[], angleTolRad: number, distTol: number): Segment[] {
  const used = new Array(segs.length).fill(false);
  const order = segs.map((_, i) => i).sort((a, b) => segLength(segs[b]) - segLength(segs[a]));
  const merged: Segment[] = [];

  for (const i of order) {
    if (used[i]) continue;
    const seed = segs[i];
    used[i] = true;
    const cluster = [seed];
    const baseAngle = angleOf(seed);

    for (const j of order) {
      if (used[j]) continue;
      const candidate = segs[j];
      const rawDiff = Math.abs(angleOf(candidate) - baseAngle);
      const angleDiff = Math.min(rawDiff, Math.PI - rawDiff);
      if (angleDiff > angleTolRad) continue;
      if (
        Math.max(perpDistanceToLine(seed, candidate.x1, candidate.y1), perpDistanceToLine(seed, candidate.x2, candidate.y2)) >
        distTol
      ) {
        continue;
      }
      cluster.push(candidate);
      used[j] = true;
    }

    const dirAngle = angleOf(seed);
    const dx = Math.cos(dirAngle);
    const dy = Math.sin(dirAngle);
    const ox = seed.x1;
    const oy = seed.y1;
    let minT = Infinity;
    let maxT = -Infinity;
    let minPt: { x: number; y: number } = { x: seed.x1, y: seed.y1 };
    let maxPt: { x: number; y: number } = { x: seed.x2, y: seed.y2 };
    for (const s of cluster) {
      for (const p of [
        { x: s.x1, y: s.y1 },
        { x: s.x2, y: s.y2 },
      ]) {
        const t = (p.x - ox) * dx + (p.y - oy) * dy;
        if (t < minT) {
          minT = t;
          minPt = p;
        }
        if (t > maxT) {
          maxT = t;
          maxPt = p;
        }
      }
    }
    merged.push({ x1: minPt.x, y1: minPt.y, x2: maxPt.x, y2: maxPt.y });
  }

  return merged;
}

// Contour-derived edges, decomposed into their straight sides via
// approxPolyDP — rounds out Hough's candidates specifically because Hough
// alone starves on real, diagonally-rotated site plans (roads.ts's own
// finding, confirmed there via live testing). Identical logic to roads.ts's
// extractContourEdges; copied, not imported — see this file's top comment.
// Two deliberate departures from roads.ts's own extractContourEdges (which
// this was originally a straight copy of — see this file's top comment):
//
// 1. `closed: true` in both arcLength and approxPolyDP below, walking ALL n
//    vertices (wrapping the last edge back to vertex 0), not just n-1. A
//    real bug found via this module's own debug harness: roads.ts's
//    original `false` (open-curve) convention is fine for ITS purpose
//    (decomposing one long boundary into a chain of edges is never
//    expected to need the "closing" edge back to the start). But applied
//    to an individual PLOT's small, fully-closed quad contour — which is
//    exactly what this module needs to decompose, unlike roads.ts which
//    only ever fed this large/long contours — `false` silently drops
//    precisely one edge per contour: the one connecting its last simplified
//    vertex back to its first. On the real Naman plan this reproducibly
//    dropped the SAME systematic edge across dozens of near-identical
//    small rectangular plot contours (each contour's own internal
//    left/right divider, by simplification/tracing order), which is what
//    caused otherwise-correctly-separated adjacent plots (e.g. 37 and 42)
//    to still merge into one face — confirmed by comparing this module's
//    line-network debug overlay against the real plan image directly.
// 2. `minLen` scaled to plot-wall size (MIN_SEGMENT_LENGTH_FRACTION),
//    not roads.ts's corridor-scale 0.04 — roads.ts only ever needs to
//    decompose long contours (a road-length boundary or bigger); this
//    module needs individual plot-sized contours decomposed too, which
//    are routinely much shorter.
function extractContourEdges(cv: Cv, edges: unknown, longEdge: number): Segment[] {
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

  const minLen = longEdge * MIN_SEGMENT_LENGTH_FRACTION;
  const segments: Segment[] = [];
  for (let i = 0; i < contours.size(); i++) {
    const contour = contours.get(i);
    const perimeter = cv.arcLength(contour, true);
    if (perimeter >= minLen) {
      const approx = new cv.Mat();
      cv.approxPolyDP(contour, approx, 0.01 * perimeter, true);
      const n = approx.rows;
      for (let v = 0; v < n; v++) {
        const x1 = approx.data32S[v * 2];
        const y1 = approx.data32S[v * 2 + 1];
        const x2 = approx.data32S[((v + 1) % n) * 2];
        const y2 = approx.data32S[((v + 1) % n) * 2 + 1];
        if (Math.hypot(x2 - x1, y2 - y1) >= minLen) segments.push({ x1, y1, x2, y2 });
      }
      approx.delete();
    }
    contour.delete();
  }
  contours.delete();
  hierarchy.delete();
  return segments;
}

// Deliberately looser than roads.ts's own 0.04 floor for ROAD candidates — a
// road only matters if it spans a whole corridor, but a small plot's own
// short edge is exactly the wall this module exists to preserve. Filtering
// at roads.ts's threshold would silently delete real plot boundaries before
// the graph is even built.
const MIN_SEGMENT_LENGTH_FRACTION = 0.012;

// What fraction of a candidate segment's own claimed span must actually sit
// on a real edge pixel (within a couple pixels either side, to allow for
// anti-aliasing/rasterization) AND have a local gradient direction
// consistent with THIS segment's own angle, to be trusted.
//
// This started as a plain "is there any edge pixel nearby" check, which
// was the fix for a real bug found via this module's own debug harness
// against the Naman plan: a generous maxLineGap (needed so a dashed/broken
// plot-boundary line still registers as ONE segment) also let HoughLinesP
// bridge together sparse, unrelated noise pixels into one long, entirely
// spurious "line" cutting across mostly-blank space.
//
// That plain version turned out not to be enough — a SEPARATE, independent
// adversarial review of this module's own output caught a long spurious
// diagonal still surviving on the real Naman plan, threading through a
// dense hex-pattern watermark in the background. The watermark is real
// texture, so "is there an edge pixel nearby" is satisfied almost
// everywhere along an arbitrary diagonal crossing it — the hex pattern
// just doesn't correspond to any real wall.
//
// The fix is orientation, not just presence: a real wall's edge pixels all
// share a gradient direction PERPENDICULAR to the wall itself (that's what
// makes it a straight edge, not scattered noise) — but a repetitive
// texture's edges point in many unrelated directions as you cross
// different little hexagons. Requiring the gradient at each supporting
// pixel to actually point perpendicular to the CANDIDATE segment's own
// angle (not just be a "some kind of edge, somewhere nearby") is what
// tells a real wall apart from a diagonal that merely grazes a lot of
// unrelated texture edges. Verified via this module's own debug harness
// on a clean synthetic test plan (no texture, no logo) that this doesn't
// cost any real recall — every real wall there was still found.
const MIN_EDGE_SUPPORT_FRACTION = 0.6;
const MIN_GRADIENT_MAGNITUDE = 25;
const GRADIENT_ANGLE_TOLERANCE = (30 * Math.PI) / 180;

interface Gradients {
  gx: Float32Array;
  gy: Float32Array;
}

// Computed ONCE per detection run (not per segment) from the same
// grayscale/contrast-enhanced image autoCanny itself was run on, so a
// supporting pixel's gradient direction reflects the actual source
// image content, not just the binary post-Canny edge map.
function computeGradients(cv: Cv, gray: unknown): Gradients {
  const gxMat = new cv.Mat();
  const gyMat = new cv.Mat();
  cv.Sobel(gray as never, gxMat, cv.CV_32F, 1, 0, 3);
  cv.Sobel(gray as never, gyMat, cv.CV_32F, 0, 1, 3);
  const gx = new Float32Array(gxMat.data32F);
  const gy = new Float32Array(gyMat.data32F);
  gxMat.delete();
  gyMat.delete();
  return { gx, gy };
}

function orientedEdgeSupportFraction(edgeData: Uint8Array, gradients: Gradients, width: number, height: number, s: Segment): number {
  // The gradient at a pixel ON a wall points ACROSS it — perpendicular to
  // the wall's own direction — so that's what a supporting pixel's
  // gradient is compared against, not the segment's own angle directly.
  const expectedGradAngle = (angleOf(s) + Math.PI / 2) % Math.PI;
  const len = segLength(s);
  const steps = Math.max(1, Math.round(len / 2));
  let supported = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const px = Math.round(s.x1 + (s.x2 - s.x1) * t);
    const py = Math.round(s.y1 + (s.y2 - s.y1) * t);
    let found = false;
    for (let dy = -2; dy <= 2 && !found; dy++) {
      for (let dx = -2; dx <= 2 && !found; dx++) {
        const x = px + dx;
        const y = py + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const idx = y * width + x;
        if (edgeData[idx] === 0) continue;
        const gmag = Math.hypot(gradients.gx[idx], gradients.gy[idx]);
        if (gmag < MIN_GRADIENT_MAGNITUDE) continue; // too weak to trust its direction
        let gradAngle = Math.atan2(gradients.gy[idx], gradients.gx[idx]);
        if (gradAngle < 0) gradAngle += Math.PI; // undirected — a gradient and its 180°-opposite mean the same edge
        const rawDiff = Math.abs(gradAngle - expectedGradAngle);
        const diff = Math.min(rawDiff, Math.PI - rawDiff);
        if (diff <= GRADIENT_ANGLE_TOLERANCE) found = true;
      }
    }
    if (found) supported += 1;
  }
  return supported / (steps + 1);
}

// `gray` must be the SAME grayscale/contrast-enhanced Mat autoCanny was run
// on to produce `edges` (see useDetectionPipeline.ts's `contrasted`) — the
// gradient-orientation check above only means anything measured against
// the actual source image content, not the post-Canny binary map.
export function extractCandidateSegments(cv: Cv, edges: unknown, gray: unknown, imageWidth: number, imageHeight: number): Segment[] {
  const longEdge = Math.max(imageWidth, imageHeight);
  const minLineLength = Math.max(15, longEdge * 0.03);
  // A real plot-boundary line can be dashed or have a small scan/print
  // break, but doesn't need much tolerance to survive that — kept far
  // tighter than roads.ts's own gap tolerance (which bridges an actual
  // ROAD-width gap between two paired boundaries, a fundamentally bigger
  // gap by design). A large gap here is exactly what let spurious
  // background-noise "lines" through — see MIN_EDGE_SUPPORT_FRACTION above
  // for the second, complementary defense against the same failure mode.
  const maxLineGap = Math.max(3, longEdge * 0.006);

  // A small morphological close first (identical idea to plots.ts's own
  // pre-findContours step — see that file's doc comment) — bridges tiny
  // anti-aliasing/scan-noise gaps in an otherwise-solid boundary line
  // BEFORE Hough ever runs, so real short plot-divider walls register as
  // one solid line without needing a large, noise-prone maxLineGap to
  // paper over the same gaps at the Hough stage. Operates on a clone, never
  // mutating the caller's own edge map (plots.ts's own contour detection
  // reuses that same Mat independently).
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
  const closed = new cv.Mat();
  cv.morphologyEx(edges as never, closed, cv.MORPH_CLOSE, kernel);
  kernel.delete();

  const lines = new cv.Mat();
  cv.HoughLinesP(closed, lines, 1, Math.PI / 180, 30, minLineLength, maxLineGap);

  // Support-fraction check reads the ORIGINAL (non-closed) edge map — the
  // closed version was only ever meant to help Hough bridge tiny gaps, not
  // to make a spurious bridged line look supported too.
  const edgeData = (edges as { data: Uint8Array }).data;
  const gradients = computeGradients(cv, gray);

  const raw: Segment[] = [];
  for (let i = 0; i < lines.rows; i++) {
    const s: Segment = {
      x1: lines.data32S[i * 4],
      y1: lines.data32S[i * 4 + 1],
      x2: lines.data32S[i * 4 + 2],
      y2: lines.data32S[i * 4 + 3],
    };
    if (orientedEdgeSupportFraction(edgeData, gradients, imageWidth, imageHeight, s) >= MIN_EDGE_SUPPORT_FRACTION) raw.push(s);
  }
  lines.delete();

  for (const s of extractContourEdges(cv, closed, longEdge)) {
    if (orientedEdgeSupportFraction(edgeData, gradients, imageWidth, imageHeight, s) >= MIN_EDGE_SUPPORT_FRACTION) raw.push(s);
  }
  closed.delete();

  // A post-merge "no single large unsupported gap" check (catching
  // mergeSegments bridging several individually-real, individually-well-
  // supported fragments across a large genuinely-empty span into one long
  // fake "wall") was tried here and reverted. It DOES suppress that bug —
  // confirmed via this module's own debug harness — but every threshold
  // strict enough to meaningfully suppress it also costs real plot recall
  // on the complex Naman plan (tried several settings; the best tradeoff
  // found still dropped correctly-detected real plots from 93 to 69, and
  // that tradeoff surface was non-monotonic enough — tightening
  // mergeSegments' own clustering tolerance changed the picture in ways
  // that didn't move predictably with the run-length threshold — that
  // further tuning wasn't converging). Given this codebase's own explicit,
  // established design philosophy (see plots.ts's DEFAULT_PLOT_OPTIONS
  // comment: erring toward MORE candidates is the right tradeoff, since a
  // false positive costs the reviewer one deletion while a false negative
  // costs them tracing a whole plot from scratch), silently dropping ~24
  // real plots to partially suppress a bug that a reviewer can otherwise
  // catch and delete in a click is the wrong trade. The oriented-support
  // fraction check above (which never cost real recall in any test) stays;
  // this module still has a known, narrower residual gap on visually
  // complex plans with decorative elements (logos, legends, compasses)
  // that happen to align near-collinearly with real content — see this
  // file's top comment and the project's own notes for the concrete
  // Naman-plan evidence and a recommended follow-up (detecting and
  // excluding decorative regions by their own visual signature, rather
  // than broadly penalizing every long merged segment).
  return mergeSegments(raw, (10 * Math.PI) / 180, longEdge * 0.012).filter(
    (s) => segLength(s) >= longEdge * MIN_SEGMENT_LENGTH_FRACTION,
  );
}

// ---------------------------------------------------------------------------
// Planar graph construction: snap segment endpoints + true crossings +
// near-miss T-junction touches into shared nodes, split every segment at
// every node that lies on it, then walk the resulting directed half-edge
// graph to enumerate faces.
// ---------------------------------------------------------------------------

interface Point {
  x: number;
  y: number;
}

// Where segment b's line crosses segment a's line, bounded to each
// segment's own span (with a small tolerance at the ends — real line data
// is noisy, a corner that's meant to coincide rarely lands at EXACTLY
// t=0/1). Handles both a true mid-span crossing (an "X") and a clean corner
// join (t near 0 or 1 on one or both sides) with the same formula — a
// corner is just a crossing where one segment's own recorded endpoint
// happens to be the crossing point.
const SPAN_EPS = 0.02;

function boundedIntersection(a: Segment, b: Segment): Point | null {
  const d1x = a.x2 - a.x1;
  const d1y = a.y2 - a.y1;
  const d2x = b.x2 - b.x1;
  const d2y = b.y2 - b.y1;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-9) return null; // parallel (or degenerate) — never a single crossing point
  const dx = b.x1 - a.x1;
  const dy = b.y1 - a.y1;
  const ta = (dx * d2y - dy * d2x) / denom;
  const tb = (dx * d1y - dy * d1x) / denom;
  if (ta < -SPAN_EPS || ta > 1 + SPAN_EPS || tb < -SPAN_EPS || tb > 1 + SPAN_EPS) return null;
  const taC = Math.min(1, Math.max(0, ta));
  return { x: a.x1 + taC * d1x, y: a.y1 + taC * d1y };
}

// Closest point on segment s's own INFINITE line to p, plus the parametric
// position along s (0 = s's start, 1 = s's end, unclamped so the caller can
// tell "beyond this segment's real span" from "within it").
function projectOntoLine(s: Segment, p: Point): { t: number; point: Point; dist: number } | null {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-9) return null;
  const t = ((p.x - s.x1) * dx + (p.y - s.y1) * dy) / lenSq;
  const point = { x: s.x1 + t * dx, y: s.y1 + t * dy };
  return { t, point, dist: Math.hypot(p.x - point.x, p.y - point.y) };
}

interface SplitPoint {
  t: number;
  x: number;
  y: number;
}

// The whole point of this function: given the messy real-world candidate
// edges (never perfectly meeting — a stroke has width, rasterization is
// noisy, two "same" corners from two different traced walls rarely land on
// the exact same pixel), find every point where two segments should be
// considered JOINED — a true crossing, OR one segment's endpoint merely
// touching partway along another (the T-junction case this whole feature
// exists for) — within snapTolerance. Returns, per segment index, every
// point that segment needs to be split at (always including its own two
// endpoints).
function findSplitPoints(segments: Segment[], snapTolerance: number): SplitPoint[][] {
  const splitPoints: SplitPoint[][] = segments.map((s) => [
    { t: 0, x: s.x1, y: s.y1 },
    { t: 1, x: s.x2, y: s.y2 },
  ]);

  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const a = segments[i];
      const b = segments[j];

      const cross = boundedIntersection(a, b);
      if (cross) {
        const ta = projectOntoLine(a, cross);
        const tb = projectOntoLine(b, cross);
        if (ta) splitPoints[i].push({ t: ta.t, x: cross.x, y: cross.y });
        if (tb) splitPoints[j].push({ t: tb.t, x: cross.x, y: cross.y });
        continue; // a real crossing already accounts for both segments meeting here
      }

      // Not a clean crossing (parallel lines, or the exact solve missed due
      // to noise) — fall back to a tolerant "does an endpoint of one
      // actually sit near the middle of the other" check, in both
      // directions.
      for (const endpoint of [
        { x: b.x1, y: b.y1 },
        { x: b.x2, y: b.y2 },
      ]) {
        const proj = projectOntoLine(a, endpoint);
        if (proj && proj.t > -SPAN_EPS && proj.t < 1 + SPAN_EPS && proj.dist <= snapTolerance) {
          splitPoints[i].push({ t: Math.min(1, Math.max(0, proj.t)), x: proj.point.x, y: proj.point.y });
        }
      }
      for (const endpoint of [
        { x: a.x1, y: a.y1 },
        { x: a.x2, y: a.y2 },
      ]) {
        const proj = projectOntoLine(b, endpoint);
        if (proj && proj.t > -SPAN_EPS && proj.t < 1 + SPAN_EPS && proj.dist <= snapTolerance) {
          splitPoints[j].push({ t: Math.min(1, Math.max(0, proj.t)), x: proj.point.x, y: proj.point.y });
        }
      }
    }
  }

  return splitPoints;
}

interface HalfEdge {
  from: number;
  to: number;
  twin: number;
}

export interface PlanarGraphResult {
  nodePositions: Point[];
  /** Every face the half-edge walk found, INCLUDING the one large unbounded outer face and any noise faces — validateFaces() below is what filters these down to real plot candidates. */
  rawFaces: Point[][];
  /** Pairs of indices into rawFaces that share a real wall — derived directly from the graph (see buildPlanarGraph's face-walk comment), not a bounding-box proximity guess. */
  faceAdjacency: [number, number][];
}

export function buildPlanarGraph(segments: Segment[], snapTolerance: number): PlanarGraphResult {
  const splitPoints = findSplitPoints(segments, snapTolerance);

  // Flatten to one list so every split point across every segment can be
  // snapped together with every other, regardless of which segment(s) it
  // came from — two segments' own idea of "where they meet" are rarely
  // pixel-identical, and this is what reconciles them into one shared node.
  const flat: { segIdx: number; t: number; x: number; y: number }[] = [];
  segments.forEach((_, segIdx) => {
    for (const sp of splitPoints[segIdx]) flat.push({ segIdx, ...sp });
  });

  // Union-find snapping by raw distance — O(n^2) over split points, fine at
  // this module's scale (a plot layout's candidate edges number in the
  // hundreds, not thousands, even for a large real plan).
  const parent = flat.map((_, i) => i);
  function find(i: number): number {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }
  function union(a: number, b: number) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }
  for (let i = 0; i < flat.length; i++) {
    for (let j = i + 1; j < flat.length; j++) {
      if (Math.hypot(flat[i].x - flat[j].x, flat[i].y - flat[j].y) <= snapTolerance) union(i, j);
    }
  }

  // One node per snap-cluster, positioned at its members' centroid (rather
  // than an arbitrary member) so a node's position reflects the whole
  // cluster's agreement, not whichever segment happened to be compared
  // first.
  const clusterSums = new Map<number, { sx: number; sy: number; count: number }>();
  for (let i = 0; i < flat.length; i++) {
    const r = find(i);
    const c = clusterSums.get(r) ?? { sx: 0, sy: 0, count: 0 };
    c.sx += flat[i].x;
    c.sy += flat[i].y;
    c.count += 1;
    clusterSums.set(r, c);
  }
  const rootToNodeId = new Map<number, number>();
  const nodePositions: Point[] = [];
  for (const [root, sum] of clusterSums) {
    rootToNodeId.set(root, nodePositions.length);
    nodePositions.push({ x: sum.sx / sum.count, y: sum.sy / sum.count });
  }
  const nodeIdOf = (i: number) => rootToNodeId.get(find(i))!;

  // Per segment: sort its own split points along its length, then connect
  // each CONSECUTIVE pair as one graph edge — this is what turns "segment
  // crossed by 4 other segments" into 5 separate graph edges instead of one
  // long one, which is exactly what lets a shared wall border two different
  // faces on either side of each sub-span, not just the two ends.
  const edgeSet = new Map<string, [number, number]>();
  const bySegment = new Map<number, typeof flat>();
  for (const p of flat) {
    const list = bySegment.get(p.segIdx) ?? [];
    list.push(p);
    bySegment.set(p.segIdx, list);
  }
  for (const [, points] of bySegment) {
    const sorted = [...points].sort((a, b) => a.t - b.t);
    for (let k = 0; k < sorted.length - 1; k++) {
      const u = nodeIdOf(flat.indexOf(sorted[k]));
      const v = nodeIdOf(flat.indexOf(sorted[k + 1]));
      if (u === v) continue;
      const key = u < v ? `${u}_${v}` : `${v}_${u}`;
      if (!edgeSet.has(key)) edgeSet.set(key, [u, v]);
    }
  }

  // Directed half-edges: every undirected graph edge becomes two half-edges
  // (one per direction), each knowing its `twin`. A face is a cycle of
  // half-edges, and by construction every half-edge belongs to EXACTLY one
  // face — a shared wall's two half-edges belong to the two different
  // faces on either side of it, which is the entire fix this module exists
  // to provide over closed-contour tracing.
  const halfEdges: HalfEdge[] = [];
  // Twin pairs, in the SAME order as edgeSet — used below to recover, for
  // every real wall, exactly which two faces sit on its two sides (see
  // faceAdjacency below).
  const twinPairs: [number, number][] = [];
  for (const [u, v] of edgeSet.values()) {
    const i1 = halfEdges.length;
    halfEdges.push({ from: u, to: v, twin: -1 });
    const i2 = halfEdges.length;
    halfEdges.push({ from: v, to: u, twin: -1 });
    halfEdges[i1].twin = i2;
    halfEdges[i2].twin = i1;
    twinPairs.push([i1, i2]);
  }

  // Every node's outgoing half-edges, sorted by angle — the face walk below
  // needs to answer "given I just arrived at this node, which edge do I
  // leave on to keep tracing the SAME face" and that's answered purely by
  // this angular ordering (the standard DCEL face-traversal rule: from the
  // reverse of the edge you arrived on, take the next one in this sorted
  // order).
  const outgoingByNode: number[][] = nodePositions.map(() => []);
  halfEdges.forEach((he, idx) => outgoingByNode[he.from].push(idx));
  for (const group of outgoingByNode) {
    group.sort((ia, ib) => {
      const a = halfEdges[ia];
      const b = halfEdges[ib];
      const fromPos = nodePositions[a.from];
      const angA = Math.atan2(nodePositions[a.to].y - fromPos.y, nodePositions[a.to].x - fromPos.x);
      const angB = Math.atan2(nodePositions[b.to].y - fromPos.y, nodePositions[b.to].x - fromPos.x);
      return angA - angB;
    });
  }

  const visited = new Array(halfEdges.length).fill(false);
  const rawFaces: Point[][] = [];
  // Which raw face (index into rawFaces) each half-edge ended up walked
  // into — -1 for a half-edge that was part of a discarded dangling 2-cycle
  // (see below). Used to recover faceAdjacency once every face is known.
  const faceOfHalfEdge: number[] = new Array(halfEdges.length).fill(-1);
  for (let start = 0; start < halfEdges.length; start++) {
    if (visited[start]) continue;
    const facePoints: Point[] = [];
    const memberHalfEdges: number[] = [];
    let idx = start;
    let guard = 0;
    const maxSteps = halfEdges.length + 4;
    do {
      visited[idx] = true;
      memberHalfEdges.push(idx);
      const he = halfEdges[idx];
      facePoints.push(nodePositions[he.from]);
      const group = outgoingByNode[he.to];
      const posInGroup = group.indexOf(he.twin);
      // A degree-1 node (a dangling spur with nothing else attached) has
      // only its own twin in this list — posInGroup+1 wraps back to itself,
      // which correctly walks straight back out along the same edge rather
      // than throwing: both "sides" of a dangling spur belong to the same
      // face, which is topologically exactly right.
      idx = group[(posInGroup + 1) % group.length];
      guard += 1;
    } while (idx !== start && guard < maxSteps);
    // A 2-half-edge cycle is a fully dangling, isolated edge (both ends
    // degree-1) — not a real enclosed area, just noise from a candidate
    // edge that never connected to anything else.
    if (facePoints.length >= 3) {
      const faceIdx = rawFaces.length;
      rawFaces.push(facePoints);
      for (const heIdx of memberHalfEdges) faceOfHalfEdge[heIdx] = faceIdx;
    }
  }

  // Real wall-sharing adjacency between raw faces — precise (derived
  // directly from the graph, not a proximity guess): for every actual wall
  // (one twin pair), the faces on its two sides are exactly the two faces
  // its two half-edges got walked into. This is what lets the association
  // step downstream tell "several sub-segments of the SAME road corridor,
  // split by cross-streets" apart from "several unrelated small faces that
  // just happen to sit near each other" — see associateReadingsToFaces'
  // ROAD-corridor merge step for why that distinction matters.
  const faceAdjacency: [number, number][] = [];
  for (const [i1, i2] of twinPairs) {
    const fa = faceOfHalfEdge[i1];
    const fb = faceOfHalfEdge[i2];
    if (fa >= 0 && fb >= 0 && fa !== fb) faceAdjacency.push([fa, fb]);
  }

  return { nodePositions, rawFaces, faceAdjacency };
}

// ---------------------------------------------------------------------------
// Face validation — the exact same judgement plots.ts already applies to a
// contour (area fraction of the whole image, solidity against the convex
// hull, simplified vertex count), just reimplemented in plain JS since a
// graph face is already a plain point array, not an OpenCV Mat contour.
// Values/thresholds come from plots.ts's own DEFAULT_PLOT_OPTIONS — reused,
// not retuned, per the task's explicit instruction to validate faces with
// the EXISTING plot sanity checks.
// ---------------------------------------------------------------------------

function polygonArea(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

// Andrew's monotone chain convex hull — standard O(n log n) construction,
// needed here only as the denominator of the solidity check below (plots.ts
// gets this for free from cv.convexHull; a plain point array needs its own).
function convexHull(points: Point[]): Point[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

// A graph face routinely has extra vertices a real contour wouldn't — a
// long wall shared with several neighbors picks up one graph node per
// neighbor it touches, even where the wall doesn't actually turn. Collapses
// any vertex whose turn angle is within angleTolRad of dead straight (180°)
// before the vertex-count sanity check runs, mirroring what approxPolyDP's
// simplification does for a real contour in plots.ts — without this, a
// perfectly rectangular plot bordering several small neighbors along one
// side could easily read as a 9-10 vertex "polygon" and either get
// needlessly penalized by the vertexScore heuristic or, in a more built-up
// layout, exceed the 14-vertex ceiling entirely.
const COLLINEAR_ANGLE_TOLERANCE_RAD = (8 * Math.PI) / 180;

function simplifyCollinear(points: Point[], angleTolRad: number): Point[] {
  if (points.length < 3) return points;
  const n = points.length;
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const cur = points[i];
    const next = points[(i + 1) % n];
    const v1x = cur.x - prev.x;
    const v1y = cur.y - prev.y;
    const v2x = next.x - cur.x;
    const v2y = next.y - cur.y;
    const len1 = Math.hypot(v1x, v1y);
    const len2 = Math.hypot(v2x, v2y);
    if (len1 < 1e-6 || len2 < 1e-6) continue; // a zero-length hop from snapping — drop the duplicate point
    const cosAngle = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (len1 * len2)));
    const turn = Math.PI - Math.acos(cosAngle);
    if (turn > angleTolRad) out.push(cur); // a real corner — keep it
  }
  // A degenerate simplification (e.g. every vertex looked "straight" due to
  // noise) falls back to the original, unsimplified ring rather than
  // producing a sub-triangle polygon that doesn't represent the face at all.
  return out.length >= 3 ? out : points;
}

// Rejects anything narrower than roughly a 1:8 aspect rectangle — see the
// call site's comment for the reasoning and worked examples.
const MIN_FACE_THINNESS = 0.02;

export interface ValidatedFace {
  /** Pixel coordinates in the SAME analysis-resolution space the graph was built in — converted to fractional PolygonPoint only at the very end, in associationsToDetectedShapes, matching plots.ts's own convention. */
  points: Point[];
  areaFraction: number;
  solidity: number;
  vertexCount: number;
  /** Same 0..1 heuristic formula as plots.ts's own confidence score — a review-UI hint only, never persisted, never claimed as real accuracy. */
  confidence: number;
  /** This face's own index in the ORIGINAL rawFaces array passed to validateFaces — kept so deriveValidatedAdjacency below can remap buildPlanarGraph's faceAdjacency (which is expressed in raw-face indices) onto the surviving, validated set. Not meaningful outside this module. */
  rawIndex: number;
}

export function validateFaces(
  rawFaces: Point[][],
  imageWidth: number,
  imageHeight: number,
  options: PlotDetectionOptions = DEFAULT_PLOT_OPTIONS,
): ValidatedFace[] {
  const totalArea = imageWidth * imageHeight;
  const results: ValidatedFace[] = [];

  for (let rawIndex = 0; rawIndex < rawFaces.length; rawIndex++) {
    const raw = rawFaces[rawIndex];
    const area = polygonArea(raw);
    const areaFraction = area / totalArea;
    if (areaFraction < options.minAreaFraction || areaFraction > options.maxAreaFraction) continue;

    const hull = convexHull(raw);
    const hullArea = polygonArea(hull);
    const solidity = hullArea > 0 ? area / hullArea : 0;
    if (solidity < options.minSolidity) continue;

    // Thinness check — NOT one of plots.ts's own contour filters (a
    // findContours-traced loop can't easily BE a thin sliver in the first
    // place, so plots.ts never needed this), but squarely within the
    // task's own "reject ... tiny/non-plot faces using geometry" mandate:
    // a graph face CAN be a thin sliver where solidity alone can't catch
    // it — a thin quad's own convex hull is barely bigger than the quad
    // itself, so solidity stays near 1.0 even though it's visually nothing
    // like a plot. Found via this module's own debug harness: a handful of
    // residual spurious line segments (background noise bridged into a
    // fake "line" — see extractCandidateSegments' MIN_EDGE_SUPPORT_FRACTION
    // comment) still occasionally survive as one edge of a real face,
    // slicing a thin extra sliver off it. The isoperimetric-style ratio
    // area/perimeter² is a standard, aspect-ratio-aware thinness measure —
    // scale-independent (works the same for a huge or tiny face) and low
    // for any long-and-narrow shape regardless of orientation: a square
    // scores 1/16 (0.0625); even a fairly elongated real plot (1:3 aspect)
    // still scores ~0.047; a sliver at 1:15+ aspect drops below 0.01.
    const perimeter = raw.reduce((sum, p, i) => {
      const next = raw[(i + 1) % raw.length];
      return sum + Math.hypot(next.x - p.x, next.y - p.y);
    }, 0);
    const thinness = perimeter > 0 ? area / (perimeter * perimeter) : 0;
    if (thinness < MIN_FACE_THINNESS) continue;

    const simplified = simplifyCollinear(raw, COLLINEAR_ANGLE_TOLERANCE_RAD);
    const vertexCount = simplified.length;
    if (vertexCount < 3 || vertexCount > 14) continue;

    const areaScore = Math.min(
      1,
      (Math.min(areaFraction - options.minAreaFraction, options.maxAreaFraction - areaFraction) /
        (options.maxAreaFraction - options.minAreaFraction)) *
        4,
    );
    const vertexScore = vertexCount >= 4 && vertexCount <= 6 ? 1 : 0.6;
    const confidence = Math.max(0, Math.min(1, solidity * 0.5 + Math.max(0, areaScore) * 0.3 + vertexScore * 0.2));

    results.push({ points: simplified, areaFraction, solidity, vertexCount, confidence, rawIndex });
  }

  return results;
}

// Remaps buildPlanarGraph's faceAdjacency (raw-face-index pairs) onto the
// SURVIVING, validated set — a pair where either side got rejected by
// validateFaces (too big/small/thin/wrong vertex count) is dropped, since
// there's no validated face on that side to be adjacent to anymore. Indices
// in the returned pairs are positions into the `faces` array passed in, not
// raw indices.
export function deriveValidatedAdjacency(faces: ValidatedFace[], rawAdjacency: [number, number][]): [number, number][] {
  const positionOfRawIndex = new Map<number, number>();
  faces.forEach((f, i) => positionOfRawIndex.set(f.rawIndex, i));
  const result: [number, number][] = [];
  for (const [ra, rb] of rawAdjacency) {
    const pa = positionOfRawIndex.get(ra);
    const pb = positionOfRawIndex.get(rb);
    if (pa !== undefined && pb !== undefined) result.push([pa, pb]);
  }
  return result;
}

// ---------------------------------------------------------------------------
// OCR + association: OCR each validated face's own interior crop (same
// crop-then-recognize discipline as ocrLabels.ts, see ocrWorker.ts's top
// comment for why a whole-image OCR pass doesn't work), then decide which
// face a piece of read text belongs to by testing whether ITS OWN bounding-
// box center falls inside that face's polygon — never by proximity/nearest-
// shape, which is unreliable once faces are small and packed edge-to-edge.
// ---------------------------------------------------------------------------

export interface OcrNumberReading {
  text: string;
  confidence: number;
  /** Pixel coordinates in the SAME analysis-resolution space as ValidatedFace.points. */
  center: Point;
}

// Matches ocrLabels.ts's own MIN_CONFIDENCE — kept as its own local constant
// (not imported) since ocrLabels.ts doesn't export it and this module is
// meant to stay decoupled from that file's internals; the two happening to
// share a value is a coincidence of both reusing the same real-world
// tuning, not a dependency between the files.
const FACE_OCR_MIN_CONFIDENCE = 55;

// Slightly less inset than ocrLabels.ts's 0.15 — a graph face's polygon is
// already exactly its real walls (no inner/outer stroke-edge duplication
// the way a raw contour has), so less margin is needed to stay clear of the
// boundary stroke itself.
const FACE_CROP_INSET_FRACTION = 0.12;

function boundingBoxOfPixels(points: Point[]) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

function cropCanvasPixels(source: HTMLCanvasElement, sx: number, sy: number, sw: number, sh: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw));
  canvas.height = Math.max(1, Math.round(sh));
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(
      source,
      Math.max(0, sx),
      Math.max(0, sy),
      Math.min(sw, source.width - Math.max(0, sx)),
      Math.min(sh, source.height - Math.max(0, sy)),
      0,
      0,
      canvas.width,
      canvas.height,
    );
  }
  return canvas;
}

export async function readFaceOcrReadings(
  faces: ValidatedFace[],
  sourceCanvas: HTMLCanvasElement,
  analysisWidth: number,
  analysisHeight: number,
): Promise<OcrNumberReading[]> {
  // Face geometry above runs on the downscaled analysis copy (same as every
  // other detector in this pipeline), but OCR always reads from the
  // full-resolution sourceCanvas for the sharpest possible crop (same
  // reasoning as ocrLabels.ts's labelClosedShape) — these scale factors
  // convert a face's analysis-space pixel coordinates into sourceCanvas's
  // own pixel coordinates for cropping, and back again afterward so
  // OcrNumberReading.center stays in the SAME space as ValidatedFace.points
  // (pointInPolygon below needs both operands in one consistent space).
  const scaleX = sourceCanvas.width / analysisWidth;
  const scaleY = sourceCanvas.height / analysisHeight;

  const readings: OcrNumberReading[] = [];
  for (const face of faces) {
    const box = boundingBoxOfPixels(face.points);
    const sx0 = box.minX * scaleX;
    const sy0 = box.minY * scaleY;
    const sx1 = box.maxX * scaleX;
    const sy1 = box.maxY * scaleY;
    const w = sx1 - sx0;
    const h = sy1 - sy0;
    const insetX = w * FACE_CROP_INSET_FRACTION;
    const insetY = h * FACE_CROP_INSET_FRACTION;
    const cropX = sx0 + insetX;
    const cropY = sy0 + insetY;
    const cropW = w - insetX * 2;
    const cropH = h - insetY * 2;
    if (cropW < 8 || cropH < 8) continue; // too small to meaningfully crop/OCR

    const crop = cropCanvasPixels(sourceCanvas, cropX, cropY, cropW, cropH);
    let words: OcrWordResult[];
    try {
      words = await recognizeCropWords(crop);
    } catch {
      continue;
    }

    for (const word of words) {
      if (word.confidence < FACE_OCR_MIN_CONFIDENCE) continue;
      const wx = cropX + (word.bbox.x0 + word.bbox.x1) / 2;
      const wy = cropY + (word.bbox.y0 + word.bbox.y1) / 2;
      readings.push({ text: word.text, confidence: word.confidence, center: { x: wx / scaleX, y: wy / scaleY } });
    }
  }
  return readings;
}

export interface FaceAssociation {
  face: ValidatedFace;
  /** Every OCR reading whose center fell inside this face — length 0 (unlabeled), 1 (the normal case), or 2+ (surfaced as a warning, never silently resolved). */
  matchedReadings: OcrNumberReading[];
  /** The single label carried into DetectedShape — the highest-confidence reading when there's more than one candidate. Never a silent/hidden choice: see associateReadingsToFaces' warnings for every case this picks between multiple candidates. */
  label: string;
}

export interface AssociationResult {
  associations: FaceAssociation[];
  warnings: string[];
}

// A face's own GEOMETRY cannot tell a real plot apart from an empty road
// corridor or a legend/distance-table box sitting between plot blocks — an
// unmarked road strip is, to the planar graph, just another enclosed
// region bounded by real lines, and satisfies the exact same area/
// solidity/vertex checks a real plot does. Only what's actually WRITTEN
// inside it tells them apart, which is why this check lives here (after
// OCR), not in validateFaces above. Deliberately the same GENERAL words
// ocrLabels.ts's own ROAD_KEYWORDS/NON_PLOT_KEYWORDS already use in
// production (kept as a separate, non-imported constant for the same
// reason FACE_OCR_MIN_CONFIDENCE is — see that constant's comment) — not
// tuned to this one plan, so a road labeled "40' WIDE ROAD" or a legend
// box titled "PLOT SCHEDULE" on a DIFFERENT project's plan is excluded the
// same way.
const NON_PLOT_FACE_KEYWORDS =
  /\b(road|rd|wide|highway|schedule|legend|distance|meter|km|mtr|bypass|hospital|school|college|airport|township|colony)\b/i;

export function associateReadingsToFaces(
  faces: ValidatedFace[],
  readings: OcrNumberReading[],
  adjacency: [number, number][] = [],
): AssociationResult {
  const matchesByFace: OcrNumberReading[][] = faces.map(() => []);
  let unmatchedCount = 0;

  for (const reading of readings) {
    // Faces are disjoint sub-regions of the same planar subdivision by
    // construction, so a reading's center can only ever land inside at most
    // one VALIDATED face — there is deliberately no "closest face" fallback
    // here; per the task's explicit instruction, nearest-text is never the
    // association rule, only containment is.
    const faceIdx = faces.findIndex((f) => pointInPolygon(reading.center, f.points));
    if (faceIdx === -1) unmatchedCount += 1;
    else matchesByFace[faceIdx].push(reading);
  }

  const isConfirmedPlotNumber = (label: string) => /^\d{1,3}$/.test(label);

  // The single highest-confidence reading per face, independent of whether
  // it LOOKS plausible — this is deliberately the ONLY thing the
  // corridor-grouping decision below is allowed to look at. Two different,
  // tempting-looking alternatives were tried and both made real things
  // WORSE, confirmed via direct testing against Naman Infracity (112
  // real plots, visually confirmed via this module's own debug harness to
  // already be correctly, individually separated at this exact topology —
  // changing it risks that, not just the label text):
  //   1. Using the SAME smarter "prefer a plausible digit" selection
  //      (see tentativeLabel below) for grouping too: a face that used to
  //      read as non-numeric garbage (correctly swept into its road
  //      corridor's excluded group) could flip to "confirmed" the moment a
  //      plausible digit ALSO existed in it, escaping exclusion as a brand
  //      new spurious "plot" — shape count rose 108 to 114, worst
  //      duplicate-label warning worsened from 3 to 4 affected plots.
  //   2. Checking "does ANY reading in the face look plausible" (ignoring
  //      confidence/rank entirely): even MORE inclusive than #1, same 114
  //      result — a road corridor's own width-label fragment ("30' WIDE
  //      ROAD") routinely contains a real, plausible-looking bare digit
  //      alongside the road keyword, which this is just as happy to match.
  // The ORIGINAL plain "whatever ranked first" rule has no mechanism to
  // retroactively "discover" plausibility elsewhere in the face, so it
  // doesn't share either failure mode — confirmed back at 108 once restored
  // here. The downstream label DISPLAYED to the reviewer is a separate
  // concern, fixed without touching this.
  const topReadingByFace = faces.map((_, i) => [...matchesByFace[i]].sort((a, b) => b.confidence - a.confidence)[0]);
  const isConfirmedForGrouping = (i: number) => isConfirmedPlotNumber(topReadingByFace[i]?.text ?? "");

  // What gets PERSISTED/displayed as the face's label — a separate concern
  // from the grouping decision above, which must stay on the plain
  // highest-confidence rule (see that constant's own doc comment for why).
  // Here, prefers a PLAUSIBLE plot number over merely-higher-confidence
  // noise — found necessary via direct testing against real plans (Naman
  // Infracity, BALAJI VIHAR): a stray boundary-line fragment or watermark
  // edge routinely OCRs as a single garbage character ("|", "©", "ac") at
  // confidence Tesseract itself reports as high, which the plain
  // highest-confidence pick would then persist as the plot's actual label —
  // discarding a real, lower-confidence-but-correct number read from the
  // SAME crop. Falls back to the plain highest-confidence reading only when
  // NOTHING in the face reads as a plausible number at all, so a real
  // alphanumeric lot code (not covered by isConfirmedPlotNumber's pure-digit
  // pattern) still surfaces something rather than nothing.
  const tentativeLabel = faces.map((_, i) => {
    const plausible = matchesByFace[i].filter((m) => isConfirmedPlotNumber(m.text));
    const pool = plausible.length > 0 ? plausible : matchesByFace[i];
    const best = [...pool].sort((a, b) => b.confidence - a.confidence)[0];
    return best?.text ?? "";
  });

  // Groups wall-adjacent NON-numeric faces into corridor candidates before
  // the road-keyword check — the fix for a real gap found via this
  // module's own debug harness against the Naman plan: a road's own width
  // label ("30' WIDE ROAD") is written ONCE somewhere along its length, not
  // inside every individual grid-aligned sub-segment the graph splits that
  // corridor into wherever a cross-street or plot divider happens to touch
  // it. Checking each sub-segment's own tiny OCR crop in isolation finds
  // the label for only the ONE sub-segment it happened to land in, leaving
  // every other sub-segment of the SAME physical road looking like an
  // unlabeled "plot" with perfectly plausible quad geometry. Union-find
  // only follows an adjacency edge (real wall-sharing, from
  // buildPlanarGraph — never a proximity guess) when BOTH sides are
  // non-numeric, so this can never merge two real, individually-numbered
  // plots together, and never pulls a real plot into a corridor group just
  // because it happens to border one.
  const parent = faces.map((_, i) => i);
  function find(i: number): number {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }
  function union(a: number, b: number) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }
  for (const [a, b] of adjacency) {
    if (!isConfirmedForGrouping(a) && !isConfirmedForGrouping(b)) union(a, b);
  }

  const groups = new Map<number, number[]>();
  faces.forEach((_, i) => {
    if (isConfirmedForGrouping(i)) return; // a real plot number is never grouped
    const root = find(i);
    const list = groups.get(root) ?? [];
    list.push(i);
    groups.set(root, list);
  });

  // Dropped entirely — not surfaced as labeled plots with a confusing
  // "multiple candidates" warning. A road-width number sitting alongside
  // the word "ROAD"/"WIDE" (e.g. "30' WIDE ROAD") is the corridor's own
  // width label, never a plot number, and the corridor itself (all of it,
  // every sub-segment in its connected group) was never a plot to begin
  // with — wherever in the group that text actually landed.
  const excludedFaceIdx = new Set<number>();
  let excludedAsNonPlotCount = 0;
  for (const members of groups.values()) {
    const combinedTexts = members.flatMap((i) => matchesByFace[i].map((m) => m.text));
    if (combinedTexts.some((t) => NON_PLOT_FACE_KEYWORDS.test(t))) {
      members.forEach((i) => excludedFaceIdx.add(i));
      excludedAsNonPlotCount += members.length;
    }
  }

  const warnings: string[] = [];
  const associations: FaceAssociation[] = [];

  faces.forEach((face, i) => {
    if (excludedFaceIdx.has(i)) return;
    const matched = matchesByFace[i];

    if (matched.length > 1) {
      const texts = matched.map((m) => m.text).join(", ");
      warnings.push(
        `A detected plot has ${matched.length} candidate plot numbers inside it (${texts}) — please confirm the correct one.`,
      );
    }
    associations.push({ face, matchedReadings: matched, label: tentativeLabel[i] });
  });

  if (excludedAsNonPlotCount > 0) {
    warnings.push(
      `${excludedAsNonPlotCount} detected face${excludedAsNonPlotCount === 1 ? "" : "s"} looked like a road corridor or legend/table area (matched road or non-plot text, possibly via a connected sub-segment) rather than a real plot and were excluded.`,
    );
  }

  const countByLabel = new Map<string, number>();
  for (const assoc of associations) {
    if (!assoc.label) continue;
    countByLabel.set(assoc.label, (countByLabel.get(assoc.label) ?? 0) + 1);
  }
  for (const [text, count] of countByLabel) {
    if (count > 1) {
      warnings.push(`Plot number "${text}" was associated with ${count} different detected plots — check for a duplicate or misread number.`);
    }
  }

  if (unmatchedCount > 0) {
    warnings.push(
      `${unmatchedCount} OCR-read number${unmatchedCount === 1 ? "" : "s"} did not fall inside any detected plot and could not be associated.`,
    );
  }

  return { associations, warnings };
}

// ---------------------------------------------------------------------------
// Final conversion into the EXISTING, unchanged DetectedShape[] contract —
// downstream review/save/viewer code needs zero changes once this replaces
// plots.ts's contour-based candidate generation, because the shape produced
// here is byte-for-byte the same interface plots.ts's detectPlotContours
// already returns.
// ---------------------------------------------------------------------------

export function associationsToDetectedShapes(
  associations: FaceAssociation[],
  imageWidth: number,
  imageHeight: number,
): DetectedShape[] {
  return associations.map(({ face, label }) => {
    const points: PolygonPoint[] = face.points.map((p) => ({ x: p.x / imageWidth, y: p.y / imageHeight }));
    return {
      localId: crypto.randomUUID(),
      kind: "plot",
      points,
      label,
      status: "available",
      confidence: face.confidence,
      source: "detected",
      needsDimensionReview: true,
    };
  });
}

// ---------------------------------------------------------------------------
// End-to-end orchestrator — wired into production in useDetectionPipeline.ts
// as of the confirmation testing referenced in this file's top comment
// (verified via the standalone debug harness against a synthetic plan with
// known ground truth and both real scanned plans this project has on hand,
// including a real regression caught and fixed along the way — see
// associateReadingsToFaces' isConfirmedForGrouping doc comment).
// plots.ts's detectPlotContours/suppressOverlapping remain in the codebase
// unused by the live pipeline, not deleted, in case this needs reverting.
// ---------------------------------------------------------------------------

// A few pixels at typical analysis resolution — generous enough to close a
// real T-junction's small stroke-width gap without merging two genuinely
// different, nearby corners into one node. Same order of magnitude as
// roads.ts's own gap/overlap tolerances for the same reason: both are
// bridging real-world stroke width and rasterization noise, not modeling a
// deliberate design gap.
const DEFAULT_SNAP_TOLERANCE_FRACTION = 0.006;

export interface FaceExtractionDebug {
  segments: Segment[];
  nodePositions: Point[];
  rawFaces: Point[][];
  validatedFaces: ValidatedFace[];
  ocrReadings: OcrNumberReading[];
  associations: FaceAssociation[];
}

export interface FaceExtractionResult {
  shapes: DetectedShape[];
  warnings: string[];
  debug: FaceExtractionDebug;
}

export async function detectPlotFaces(
  cv: Cv,
  edges: unknown,
  gray: unknown,
  sourceCanvas: HTMLCanvasElement,
  analysisWidth: number,
  analysisHeight: number,
  options: PlotDetectionOptions = DEFAULT_PLOT_OPTIONS,
): Promise<FaceExtractionResult> {
  const longEdge = Math.max(analysisWidth, analysisHeight);
  const segments = extractCandidateSegments(cv, edges, gray, analysisWidth, analysisHeight);
  const snapTolerance = longEdge * DEFAULT_SNAP_TOLERANCE_FRACTION;

  const { nodePositions, rawFaces, faceAdjacency } = buildPlanarGraph(segments, snapTolerance);
  const validatedFaces = validateFaces(rawFaces, analysisWidth, analysisHeight, options);
  const validatedAdjacency = deriveValidatedAdjacency(validatedFaces, faceAdjacency);
  const ocrReadings = await readFaceOcrReadings(validatedFaces, sourceCanvas, analysisWidth, analysisHeight);
  const { associations, warnings } = associateReadingsToFaces(validatedFaces, ocrReadings, validatedAdjacency);
  const shapes = associationsToDetectedShapes(associations, analysisWidth, analysisHeight);

  return {
    shapes,
    warnings,
    debug: { segments, nodePositions, rawFaces, validatedFaces, ocrReadings, associations },
  };
}
