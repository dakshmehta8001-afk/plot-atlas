// Finds road-like LONG STRAIGHT segments in an edge map via HoughLinesP,
// then merges nearby collinear segments into fewer, longer ones — a real
// road boundary rarely survives edge detection as one unbroken line, so
// without merging, one road would fragment into a dozen tiny near-duplicate
// segments.
//
// Honest limitation, worth stating plainly rather than glossing over: this
// treats every merged segment as an independent straight road and has no
// concept of a road NETWORK (junctions, one road branching into two, a
// curved road). Real road layouts routinely need the reviewer to delete a
// spurious segment, extend one, or manually trace a curve/junction the
// merge logic couldn't represent — exactly the "Review & Edit" step the
// user called the most important part of this feature.
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
// this is what turns several short broken pieces of one road edge into one
// long segment.
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

export function detectRoadSegments(cv: Cv, edges: unknown, imageWidth: number, imageHeight: number): DetectedShape[] {
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

  const merged = mergeSegments(raw, (10 * Math.PI) / 180, longEdge * 0.015).filter(
    (s) => length(s) >= longEdge * 0.08,
  );

  return merged.map((s) => {
    const points: PolygonPoint[] = [
      { x: s.x1 / imageWidth, y: s.y1 / imageHeight },
      { x: s.x2 / imageWidth, y: s.y2 / imageHeight },
    ];
    return {
      localId: crypto.randomUUID(),
      kind: "road" as const,
      points,
      label: "",
      confidence: 0.5,
      source: "detected" as const,
    };
  });
}
