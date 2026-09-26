// Finds road CORRIDORS — not individual long straight lines. The original
// version of this file treated every sufficiently-long Hough-detected
// segment as a road on its own, which meant it had no way to tell a real
// road apart from an equally long plot boundary, a map border, or a
// dimension line: they're all "long straight segments" too.
//
// The fix is a change of question, not a threshold tweak: instead of asking
// "is this line a road?", this asks "is there a boundary, then a
// substantial and fairly consistent gap, then another boundary running
// roughly alongside it?" — a road corridor, whether it's rendered as a
// solid filled band (a real road surface) or just left blank between two
// plot blocks (a "proposed road" with no artwork of its own), is always
// that same paired-boundary-plus-gap structure. Two adjacent plots sharing
// an edge have ~zero gap; two opposite sides of ONE plot aren't a corridor
// at all (see pairBelongsToSinglePlot below); a north arrow, map border, or
// isolated decorative line never has a parallel partner to pair with in
// the first place. This is what lets those get excluded as a natural
// consequence of the corridor definition, not through special-cased rules
// for each one.
//
// Hough is still used — reused as the source of CANDIDATE edges to pair up,
// not replaced. What changed is everything downstream of it.
import type { PolygonPoint } from "@/lib/types";
import type { Cv } from "../opencvLoader";
import type { DetectedShape } from "../types";

interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function length(s: Segment): number {
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
// span it covers (the two most extreme endpoints along that direction) —
// this is what turns several short broken pieces of one edge into one long
// candidate edge before pairing ever starts. Unchanged from the original
// version; still exactly what it was doing before, just feeding candidate
// EDGES into the pairing step below instead of being treated as the final
// road output.
function mergeSegments(segs: Segment[], angleTolRad: number, distTol: number): Segment[] {
  const used = new Array(segs.length).fill(false);
  const order = segs.map((_, i) => i).sort((a, b) => length(segs[b]) - length(segs[a]));
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
      if (Math.max(perpDistanceToLine(seed, candidate.x1, candidate.y1), perpDistanceToLine(seed, candidate.x2, candidate.y2)) > distTol) {
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

// Projects both segments onto A's own direction and finds where their
// projections overlap — returns null if they don't overlap at all (two
// parallel-ish edges that happen to sit in unrelated parts of the image
// aren't a corridor, even if extending them infinitely would eventually
// bring them alongside each other). `gap` is sampled ONLY within that
// overlapping range, not each segment's full length, so a corridor formed
// from two edges of very different lengths still gets a gap reading that
// reflects where they actually run side by side.
function computeOverlapAndGap(a: Segment, b: Segment): { overlapFraction: number; gap: number; overlapMin: number; overlapMax: number } | null {
  const dirAngle = angleOf(a);
  const dx = Math.cos(dirAngle);
  const dy = Math.sin(dirAngle);
  const ox = a.x1;
  const oy = a.y1;
  const projT = (x: number, y: number) => (x - ox) * dx + (y - oy) * dy;

  const aT1 = projT(a.x1, a.y1);
  const aT2 = projT(a.x2, a.y2);
  const bT1 = projT(b.x1, b.y1);
  const bT2 = projT(b.x2, b.y2);
  const aMin = Math.min(aT1, aT2);
  const aMax = Math.max(aT1, aT2);
  const bMin = Math.min(bT1, bT2);
  const bMax = Math.max(bT1, bT2);

  const overlapMin = Math.max(aMin, bMin);
  const overlapMax = Math.min(aMax, bMax);
  const overlapLen = overlapMax - overlapMin;
  if (overlapLen <= 0) return null;

  const shorterLen = Math.min(aMax - aMin, bMax - bMin);
  const overlapFraction = shorterLen > 0 ? overlapLen / shorterLen : 0;

  const samples = 5;
  let total = 0;
  for (let i = 0; i < samples; i++) {
    const t = overlapMin + (overlapLen * i) / (samples - 1);
    total += perpDistanceToLine(b, ox + dx * t, oy + dy * t);
  }
  const gap = total / samples;

  return { overlapFraction, gap, overlapMin, overlapMax };
}

// The actual road centerline: the midline between A and B, spanning only
// their overlapping range — offset from A toward wherever B actually is
// (not an arbitrarily-chosen perpendicular side).
function computeCenterline(a: Segment, b: Segment, overlapMin: number, overlapMax: number, gap: number): Segment {
  const dirAngle = angleOf(a);
  const dx = Math.cos(dirAngle);
  const dy = Math.sin(dirAngle);
  const ox = a.x1;
  const oy = a.y1;
  const perpX = -dy;
  const perpY = dx;

  const bMidX = (b.x1 + b.x2) / 2;
  const bMidY = (b.y1 + b.y2) / 2;
  const signedOffset = (bMidX - ox) * perpX + (bMidY - oy) * perpY;
  const sign = signedOffset >= 0 ? 1 : -1;
  const halfGap = (gap / 2) * sign;

  return {
    x1: ox + dx * overlapMin + perpX * halfGap,
    y1: oy + dy * overlapMin + perpY * halfGap,
    x2: ox + dx * overlapMax + perpX * halfGap,
    y2: oy + dy * overlapMax + perpY * halfGap,
  };
}

function pointToSegmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

// True if every sampled point along `edge` sits close to SOME edge of
// `polygon` — i.e. this candidate edge is just tracing part of one plot's
// own traced boundary, not a separate structure alongside it.
function liesOnPolygonBoundary(edge: Segment, polygon: { x: number; y: number }[], tolerance: number): boolean {
  const samplePoints = 5;
  for (let i = 0; i < samplePoints; i++) {
    const t = i / (samplePoints - 1);
    const px = edge.x1 + (edge.x2 - edge.x1) * t;
    const py = edge.y1 + (edge.y2 - edge.y1) * t;
    let minDist = Infinity;
    for (let v = 0; v < polygon.length; v++) {
      const a = polygon[v];
      const b = polygon[(v + 1) % polygon.length];
      minDist = Math.min(minDist, pointToSegmentDistance(px, py, a.x, a.y, b.x, b.y));
    }
    if (minDist > tolerance) return false;
  }
  return true;
}

// The false positive a pure gap/parallelism check can't catch on its own:
// a single plot's own left and right (or top and bottom) edges ARE
// parallel, DO have a real, non-trivial gap (the plot's own width), and
// its interior IS uniform if the plot is drawn as a solid fill — every
// signal a genuine road corridor also has. What actually distinguishes
// them is topological, not geometric: a road's two boundaries belong to
// TWO DIFFERENT plot blocks with open space between; one plot's two sides
// belong to the SAME closed contour. Rejects a pair where both edges trace
// the same single already-detected plot's boundary.
function pairBelongsToSinglePlot(a: Segment, b: Segment, plotPolygons: { x: number; y: number }[][], tolerance: number): boolean {
  return plotPolygons.some((polygon) => liesOnPolygonBoundary(a, polygon, tolerance) && liesOnPolygonBoundary(b, polygon, tolerance));
}

// Even-odd ray-casting point-in-polygon test, in pixel space (roads.ts
// works in pixels throughout; src/lib/svgPolygon.ts's version works in the
// fractional 0..1 space instead, so this stays local rather than importing
// and converting back and forth for every sample point below).
function pointInPolygonPx(px: number, py: number, polygon: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

// The generalization of pairBelongsToSinglePlot that a real test against
// the actual BALAJI VIHAR plan showed was still needed: a corridor whose
// interior is substantially covered by ALREADY-DETECTED plot shapes isn't
// open road space, whether that coverage comes from one plot's own two
// sides (pairBelongsToSinglePlot's narrower case) or — the case that
// slipped through — several DIFFERENT small plots packed tightly together
// inside a dense cluster, or (a real, confirmed false positive) a site
// plan's own title text, whose individual letters get picked up as small
// spurious "plot" contours by detectPlotContours (a known, documented
// limitation there) and collectively cover most of a text row's bounding
// area. Samples a grid of points across the corridor strip and returns
// what fraction land inside ANY plot polygon.
function corridorPlotCoverage(centerline: Segment, gap: number, plotPolygons: { x: number; y: number }[][]): number {
  if (plotPolygons.length === 0) return 0;
  const dirAngle = angleOf(centerline);
  const dx = Math.cos(dirAngle);
  const dy = Math.sin(dirAngle);
  const perpX = -dy;
  const perpY = dx;
  const corridorLen = length(centerline);
  const steps = Math.max(8, Math.min(30, Math.round(corridorLen / 20)));
  const offsets = [-gap * 0.35, -gap * 0.15, 0, gap * 0.15, gap * 0.35];

  let covered = 0;
  let total = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = centerline.x1 + (centerline.x2 - centerline.x1) * t;
    const cy = centerline.y1 + (centerline.y2 - centerline.y1) * t;
    for (const off of offsets) {
      const px = cx + perpX * off;
      const py = cy + perpY * off;
      total++;
      if (plotPolygons.some((poly) => pointInPolygonPx(px, py, poly))) covered++;
    }
  }
  return total > 0 ? covered / total : 0;
}

// Samples grayscale pixel intensity across the corridor strip (3 lines
// spanning its width, evenly spaced along its length) and scores how
// UNIFORM those readings are. A real road surface — whether solid-filled
// or a blank gap — reads as fairly consistent tone; a strip that's
// actually a row of several small, differently-shaded plot fills (i.e. the
// "gap" isn't really open space, it's just more plots) reads as much
// noisier. This is a deliberately simple proxy for "is this corridor's
// interior actually open/continuous" rather than full region segmentation
// — cheap, and good enough to catch the failure mode it targets.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sampleUniformity(gray: any, centerline: Segment, gap: number, imageWidth: number, imageHeight: number): number {
  const dirAngle = angleOf(centerline);
  const dx = Math.cos(dirAngle);
  const dy = Math.sin(dirAngle);
  const perpX = -dy;
  const perpY = dx;
  const corridorLen = length(centerline);
  const steps = Math.max(6, Math.min(20, Math.round(corridorLen / Math.max(1, imageWidth * 0.02))));
  const offsets = [-gap * 0.3, 0, gap * 0.3];

  const values: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = centerline.x1 + (centerline.x2 - centerline.x1) * t;
    const cy = centerline.y1 + (centerline.y2 - centerline.y1) * t;
    for (const off of offsets) {
      const px = Math.round(cx + perpX * off);
      const py = Math.round(cy + perpY * off);
      if (px < 0 || py < 0 || px >= imageWidth || py >= imageHeight) continue;
      try {
        values.push(gray.ucharPtr(py, px)[0]);
      } catch {
        // Out-of-bounds read on the underlying Mat — just skip this sample.
      }
    }
  }
  if (values.length < 4) return 0.4; // not enough valid samples to judge either way

  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  const stdev = Math.sqrt(variance);
  // Tuned against a uniform paper/solid-fill surface reading well under
  // ~20 stdev, and a strip crossing several differently-toned plot fills
  // or dense line work reading well above ~35-40 — not derived from a
  // formula, an empirical band like the rest of this pipeline's thresholds.
  return Math.max(0, Math.min(1, 1 - stdev / 45));
}

// A dashed/tick-marked centerline is strong positive evidence for "this is
// really a road" — looks for several short segments (much shorter than the
// corridor itself) lying close to the corridor's own midline and running
// the same direction, in the RAW (pre-merge) Hough output, since dashes are
// exactly the kind of short fragment mergeSegments' clustering already
// consolidates away before this point.
function hasDashedMarking(centerline: Segment, rawSegments: Segment[], longEdge: number): boolean {
  const corridorLen = length(centerline);
  const centerAngle = angleOf(centerline);
  let dashCount = 0;
  for (const s of rawSegments) {
    const segLen = length(s);
    if (segLen < 3 || segLen > corridorLen * 0.25) continue;
    const rawDiff = Math.abs(angleOf(s) - centerAngle);
    const angleDiff = Math.min(rawDiff, Math.PI - rawDiff);
    if (angleDiff > (15 * Math.PI) / 180) continue;
    const midX = (s.x1 + s.x2) / 2;
    const midY = (s.y1 + s.y2) / 2;
    if (perpDistanceToLine(centerline, midX, midY) > longEdge * 0.012) continue;
    dashCount++;
    if (dashCount >= 3) return true;
  }
  return false;
}

// A second source of candidate edges, alongside Hough — found necessary
// after testing against a REAL scanned site plan (not a synthetic test
// image): HoughLinesP's rho/theta voting turned out to be far more
// sensitive than expected to real-world anti-aliasing on DIAGONAL lines —
// a genuinely common case, since a site plan's property boundary is
// rarely axis-aligned. Confirmed directly (not assumed): against the real
// BALAJI VIHAR plan (rotated at a diagonal angle, as most real layouts
// are), HoughLinesP found exactly ONE segment total regardless of how far
// its own thresholds were loosened, while findContours — which
// detectPlotContours already relies on successfully for the exact same
// edge map — traced the same boundaries into contours without any
// difficulty. The difference: findContours only needs pixels to be
// topologically CONNECTED to trace a path through them, while
// HoughLinesP's voting needs edge pixels to concentrate tightly in a
// single rho/theta accumulator bin, which anti-aliased stair-stepping on
// a rotated line spreads across several adjacent bins instead — this
// isn't a threshold problem (confirmed by testing much looser Hough
// thresholds directly and still getting one segment), so tuning
// HoughLinesP further wasn't the fix.
//
// This decomposes every sufficiently long contour into straight-ish
// sub-segments via approxPolyDP (the same simplification technique
// detectPlotContours already uses, just applied to ALL long contours here,
// not only small closed plot-like ones) — segments between consecutive
// simplified vertices. Duplicates (a stroke's inner/outer edge tracing the
// same boundary twice) are expected and harmless: they get consolidated by
// the SAME mergeSegments collinearity clustering already used for Hough's
// output, right below.
function extractContourEdges(cv: Cv, edges: unknown, longEdge: number): Segment[] {
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

  const minLen = longEdge * 0.04;
  const segments: Segment[] = [];
  for (let i = 0; i < contours.size(); i++) {
    const contour = contours.get(i);
    const perimeter = cv.arcLength(contour, false);
    if (perimeter >= minLen) {
      const approx = new cv.Mat();
      cv.approxPolyDP(contour, approx, 0.01 * perimeter, false);
      const n = approx.rows;
      for (let v = 0; v < n - 1; v++) {
        const x1 = approx.data32S[v * 2];
        const y1 = approx.data32S[v * 2 + 1];
        const x2 = approx.data32S[(v + 1) * 2];
        const y2 = approx.data32S[(v + 1) * 2 + 1];
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

interface CorridorCandidate {
  centerline: Segment;
  gap: number;
  confidence: number;
}

// Consolidates corridor candidates the same way mergeSegments consolidates
// raw Hough fragments (same clustering idea: roughly collinear + close +
// overlapping gets collapsed to one longest span) — necessary because
// considering every pair of candidate edges can produce several
// overlapping/duplicate corridor readings for the same physical road, not
// just fragmented pieces of a bending one. Kept as its own function rather
// than generalizing mergeSegments itself, so the original (still used
// as-is for candidate-edge generation above) stays completely unchanged.
// A cluster's confidence is its members' MAX, not an average — if any one
// reading strongly supports a corridor, that's what should win.
function mergeCorridors(candidates: CorridorCandidate[], angleTolRad: number, distTol: number): CorridorCandidate[] {
  const used = new Array(candidates.length).fill(false);
  const order = candidates.map((_, i) => i).sort((a, b) => length(candidates[b].centerline) - length(candidates[a].centerline));
  const merged: CorridorCandidate[] = [];

  for (const i of order) {
    if (used[i]) continue;
    const seed = candidates[i];
    used[i] = true;
    const cluster = [seed];
    const baseAngle = angleOf(seed.centerline);

    for (const j of order) {
      if (used[j]) continue;
      const candidate = candidates[j];
      const rawDiff = Math.abs(angleOf(candidate.centerline) - baseAngle);
      const angleDiff = Math.min(rawDiff, Math.PI - rawDiff);
      if (angleDiff > angleTolRad) continue;
      const overlap = computeOverlapAndGap(seed.centerline, candidate.centerline);
      if (!overlap || overlap.gap > distTol) continue;
      cluster.push(candidate);
      used[j] = true;
    }

    const dirAngle = angleOf(seed.centerline);
    const dx = Math.cos(dirAngle);
    const dy = Math.sin(dirAngle);
    const ox = seed.centerline.x1;
    const oy = seed.centerline.y1;
    let minT = Infinity;
    let maxT = -Infinity;
    let minPt = { x: seed.centerline.x1, y: seed.centerline.y1 };
    let maxPt = { x: seed.centerline.x2, y: seed.centerline.y2 };
    let maxConfidence = 0;
    let totalGap = 0;
    for (const c of cluster) {
      maxConfidence = Math.max(maxConfidence, c.confidence);
      totalGap += c.gap;
      for (const p of [
        { x: c.centerline.x1, y: c.centerline.y1 },
        { x: c.centerline.x2, y: c.centerline.y2 },
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
    merged.push({
      centerline: { x1: minPt.x, y1: minPt.y, x2: maxPt.x, y2: maxPt.y },
      gap: totalGap / cluster.length,
      confidence: maxConfidence,
    });
  }

  return merged;
}

// Pairing tolerances — deliberately separate from mergeSegments' own
// (stricter) collinearity tolerance above, since two DIFFERENT boundaries
// forming a corridor are naturally never as perfectly aligned as two
// fragments of the SAME edge.
const PAIR_ANGLE_TOL = (12 * Math.PI) / 180;
const MIN_OVERLAP_FRACTION = 0.35;
// Gap bounds relative to the image's own long edge — wide enough to
// include everything from a narrow 30'-wide internal lane to a major
// 150'-wide highway, without pairing up two edges that are merely
// somewhere-in-the-same-image parallel.
const MIN_GAP_FRACTION = 0.012;
const MAX_GAP_FRACTION = 0.22;
const SAME_PLOT_TOLERANCE_FRACTION = 0.006;
// Below this, a candidate is dropped before OCR ever runs on it — not
// worth spending an OCR pass on something this weak geometrically.
const MIN_GEOMETRIC_CONFIDENCE = 0.3;
// Applied AFTER OCR (see filterRoadsByConfidence) — a candidate that
// cleared the geometric bar but still reads this low, and found no
// supporting road-keyword text either, is more likely a false positive
// than a real road with unreadable text.
export const MIN_FINAL_CONFIDENCE = 0.4;

export function detectRoadSegments(
  cv: Cv,
  edges: unknown,
  gray: unknown,
  imageWidth: number,
  imageHeight: number,
  plotShapes: DetectedShape[] = [],
): DetectedShape[] {
  const longEdge = Math.max(imageWidth, imageHeight);
  const minLineLength = Math.max(20, longEdge * 0.05);
  const maxLineGap = Math.max(5, longEdge * 0.02);

  const lines = new cv.Mat();
  cv.HoughLinesP(edges, lines, 1, Math.PI / 180, 50, minLineLength, maxLineGap);

  const raw: Segment[] = [];
  for (let i = 0; i < lines.rows; i++) {
    raw.push({
      x1: lines.data32S[i * 4],
      y1: lines.data32S[i * 4 + 1],
      x2: lines.data32S[i * 4 + 2],
      y2: lines.data32S[i * 4 + 3],
    });
  }
  lines.delete();

  // Contour-derived edges (see extractContourEdges' doc comment) round out
  // Hough's candidates — added specifically because Hough alone starves on
  // real, diagonally-rotated site plans. Concatenated into the SAME raw
  // pool before merging: mergeSegments' collinearity clustering treats
  // both sources identically and consolidates any duplicates between them.
  raw.push(...extractContourEdges(cv, edges, longEdge));

  // Consolidated candidate EDGES (still just "long straight things that
  // might be part of something"), not yet roads — the old code stopped
  // here and emitted these directly. Everything below is new.
  const candidateEdges = mergeSegments(raw, (10 * Math.PI) / 180, longEdge * 0.015).filter(
    (s) => length(s) >= longEdge * 0.04,
  );

  const plotPolygons = plotShapes
    .filter((s) => s.points.length >= 3)
    .map((s) => s.points.map((p) => ({ x: p.x * imageWidth, y: p.y * imageHeight })));
  const samePlotTolerance = longEdge * SAME_PLOT_TOLERANCE_FRACTION;

  const candidates: CorridorCandidate[] = [];
  for (let i = 0; i < candidateEdges.length; i++) {
    for (let j = i + 1; j < candidateEdges.length; j++) {
      const a = candidateEdges[i];
      const b = candidateEdges[j];

      const rawAngleDiff = Math.abs(angleOf(a) - angleOf(b));
      const angleDiff = Math.min(rawAngleDiff, Math.PI - rawAngleDiff);
      if (angleDiff > PAIR_ANGLE_TOL) continue;

      const overlap = computeOverlapAndGap(a, b);
      if (!overlap) continue;
      if (overlap.overlapFraction < MIN_OVERLAP_FRACTION) continue;
      if (overlap.gap < longEdge * MIN_GAP_FRACTION || overlap.gap > longEdge * MAX_GAP_FRACTION) continue;

      if (plotPolygons.length > 0 && pairBelongsToSinglePlot(a, b, plotPolygons, samePlotTolerance)) continue;

      const centerline = computeCenterline(a, b, overlap.overlapMin, overlap.overlapMax, overlap.gap);

      // A real test against BALAJI VIHAR caught this one directly: a
      // corridor whose interior is mostly covered by OTHER already-
      // detected plots isn't open road space — a dense cluster of small
      // plots, or a site plan's own title text (individual letters get
      // picked up as small spurious "plot" contours, a known limitation of
      // detectPlotContours), can otherwise satisfy every other check here.
      const plotCoverage = corridorPlotCoverage(centerline, overlap.gap, plotPolygons);
      if (plotCoverage > 0.25) continue;

      const uniformity = sampleUniformity(gray, centerline, overlap.gap, imageWidth, imageHeight);
      const dashed = hasDashedMarking(centerline, raw, longEdge);

      // Combined geometric confidence — uniformity carries the most
      // weight (the strongest single signal for "this is open/continuous
      // space, not a subdivided row of plots"), a dashed centerline is a
      // meaningful bonus, angle/overlap quality fill in the rest. Capped
      // below 1.0 so OCR support (added afterward, in ocrLabels.ts) can
      // still visibly push a candidate from "plausible" to "confident"
      // rather than everything already maxing out on geometry alone.
      let confidence = 0.15;
      confidence += overlap.overlapFraction * 0.15;
      confidence += (1 - angleDiff / PAIR_ANGLE_TOL) * 0.1;
      confidence += uniformity * 0.3;
      if (dashed) confidence += 0.2;
      confidence = Math.max(0, Math.min(0.75, confidence));

      if (confidence < MIN_GEOMETRIC_CONFIDENCE) continue;

      candidates.push({ centerline, gap: overlap.gap, confidence });
    }
  }

  // Several candidate pairs commonly describe the same physical road (extra
  // nearby edges, or a road broken into pieces by an occluding plot
  // cluster) — collapse those before emitting.
  const merged = mergeCorridors(candidates, PAIR_ANGLE_TOL, longEdge * 0.02).filter(
    (c) => length(c.centerline) >= longEdge * 0.06,
  );

  return merged.map((c) => {
    const points: PolygonPoint[] = [
      { x: c.centerline.x1 / imageWidth, y: c.centerline.y1 / imageHeight },
      { x: c.centerline.x2 / imageWidth, y: c.centerline.y2 / imageHeight },
    ];
    return {
      localId: crypto.randomUUID(),
      kind: "road" as const,
      points,
      label: "",
      confidence: c.confidence,
      source: "detected" as const,
      // Roads aren't subject to the dimension-review gate at all (only
      // plots are) — false here is simply "not applicable", not a claim.
      needsDimensionReview: false,
    };
  });
}

// Applied after OCR has had a chance to boost confidence on any road shape
// whose crop matched a road keyword (see ocrLabels.ts) — a shape that
// cleared the geometric bar above but still reads low here, with no
// textual support either, is dropped rather than shown to the reviewer as
// a confident auto-detection.
export function filterRoadsByConfidence(shapes: DetectedShape[], threshold: number = MIN_FINAL_CONFIDENCE): DetectedShape[] {
  return shapes.filter((s) => s.kind !== "road" || (s.confidence ?? 0) >= threshold);
}
