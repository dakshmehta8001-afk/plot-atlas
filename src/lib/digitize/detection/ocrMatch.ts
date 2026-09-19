// Assigns OCR results to the shapes detection/plots.ts and detection/roads.ts
// already found. Geometry alone can't tell a park apart from a plot — both
// are just closed polygons of a plausible size — so every closed shape
// starts out labeled "plot" and gets RECLASSIFIED to a site feature here if
// a keyword (PARK/TEMPLE/GATE/...) is found inside it. A shape with no
// nearby OCR text at all is left as an unlabeled plot for the reviewer to
// fill in — never silently dropped, since "I found a boundary but couldn't
// read it" is still useful information for Review & Edit.
import type { PolygonPoint, SiteFeatureKind } from "@/lib/types";
import type { OcrWord } from "../ocrWorker";
import type { DetectedShape } from "../types";

const FEATURE_KEYWORDS: { pattern: RegExp; kind: SiteFeatureKind; label: string }[] = [
  { pattern: /\bpark\b/i, kind: "park", label: "Park" },
  { pattern: /\btemple\b/i, kind: "temple", label: "Temple" },
  { pattern: /\bgate\b/i, kind: "gate", label: "Gate" },
  { pattern: /\bclub(house)?\b/i, kind: "clubhouse", label: "Clubhouse" },
  { pattern: /\b(garden|common)\b/i, kind: "common_area", label: "Common area" },
  { pattern: /\b(pond|lake|water)\b/i, kind: "water_body", label: "Water body" },
];

// A road label needs a number ("40", "40'") — a bare word like "ROAD" isn't
// useful on its own, so this only ever produces a label when a nearby digit
// sequence is found, leaving the width preset picker (see RoadFormModal's
// existing pattern, reused by ShapeDetailsPanel) as the fallback otherwise.
const ROAD_KEYWORD = /\broad\b/i;
const NUMBER_TOKEN = /(\d+)/;

// Even-odd ray casting — standard point-in-polygon test, used here (rather
// than just nearest-centroid) so a word inside an irregularly-shaped plot
// still matches it even when the word sits off-center from the bounding-box
// centroid.
function pointInPolygon(point: PolygonPoint, polygon: PolygonPoint[]): boolean {
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

function distance(a: PolygonPoint, b: PolygonPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function centroid(points: PolygonPoint[]): PolygonPoint {
  const x = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const y = points.reduce((sum, p) => sum + p.y, 0) / points.length;
  return { x, y };
}

export function matchOcrToShapes(shapes: DetectedShape[], words: OcrWord[]): DetectedShape[] {
  // A max-distance cap (in the same 0..1 fractional units as everything
  // else) keeps a word on the far side of the image from getting assigned
  // to a shape it's nowhere near, just because nothing closer exists.
  const MAX_MATCH_DISTANCE = 0.06;
  const used = new Set<number>();

  function nearestWordTo(
    point: PolygonPoint,
    polygon: PolygonPoint[] | null,
    predicate?: (text: string) => boolean,
  ): { index: number; word: OcrWord; dist: number } | null {
    let best: { index: number; word: OcrWord; dist: number } | null = null;
    words.forEach((word, index) => {
      if (used.has(index)) return;
      if (predicate && !predicate(word.text)) return;
      const inside = polygon ? pointInPolygon(word.center, polygon) : false;
      const dist = distance(point, word.center);
      if (!inside && dist > MAX_MATCH_DISTANCE) return;
      const effectiveDist = inside ? 0 : dist;
      if (!best || effectiveDist < best.dist) best = { index, word, dist: effectiveDist };
    });
    return best;
  }

  return shapes.map((shape) => {
    if (shape.kind === "road") {
      const mid = { x: (shape.points[0].x + shape.points[shape.points.length - 1].x) / 2, y: (shape.points[0].y + shape.points[shape.points.length - 1].y) / 2 };
      const roadWord = nearestWordTo(mid, null, (t) => ROAD_KEYWORD.test(t) || NUMBER_TOKEN.test(t));
      if (roadWord) {
        used.add(roadWord.index);
        const numberMatch = roadWord.word.text.match(NUMBER_TOKEN);
        if (numberMatch) return { ...shape, label: `${numberMatch[1]} ft` };
      }
      return shape;
    }

    // shape.kind === "plot" candidates get checked against the feature
    // keyword list first — a contour containing the word "PARK" should
    // become a park, not a plot numbered "PARK".
    const center = centroid(shape.points);
    for (const { pattern, kind, label } of FEATURE_KEYWORDS) {
      const match = nearestWordTo(center, shape.points, (t) => pattern.test(t));
      if (match) {
        used.add(match.index);
        return { ...shape, kind: "feature" as const, featureKind: kind, label, status: undefined };
      }
    }

    const numberWord = nearestWordTo(center, shape.points, (t) => NUMBER_TOKEN.test(t) && !ROAD_KEYWORD.test(t));
    if (numberWord) {
      used.add(numberWord.index);
      return { ...shape, label: numberWord.word.text };
    }

    return shape;
  });
}
