// Labels each detected shape by OCR-ing a small CROP of its own interior —
// not by running one OCR pass over the whole plan image. That's the fix for
// a real bug found via extensive isolated testing (see ocrWorker.ts's doc
// comment for the full story): a whole-image pass, at any page-segmentation
// mode tried, consistently misread every plot number as short garbage.
// Cropping to just one shape's interior (inset inward to stay clear of its
// own boundary stroke) and reading it with PSM.SINGLE_BLOCK reads correctly
// at 90%+ confidence — confirmed empirically, not assumed.
import type { PolygonPoint, SiteFeatureKind } from "@/lib/types";
import { recognizeCrop, type OcrCropResult } from "../ocrWorker";
import type { DetectedShape } from "../types";

const FEATURE_KEYWORDS: { pattern: RegExp; kind: SiteFeatureKind; label: string }[] = [
  { pattern: /\bpark\b/i, kind: "park", label: "Park" },
  { pattern: /\btemple\b/i, kind: "temple", label: "Temple" },
  { pattern: /\bgate\b/i, kind: "gate", label: "Gate" },
  { pattern: /\bclub(house)?\b/i, kind: "clubhouse", label: "Clubhouse" },
  { pattern: /\b(garden|common)\b/i, kind: "common_area", label: "Common area" },
  { pattern: /\b(pond|lake|water)\b/i, kind: "water_body", label: "Water body" },
];

const ROAD_NUMBER = /(\d+)/;

// Below this, an OCR result is treated the same as "found nothing" rather
// than trusted to auto-fill a label — a wrong-but-confident-looking label
// is worse for the reviewer than an empty one they're prompted to fill in.
const MIN_CONFIDENCE = 55;

function boundingBox(points: PolygonPoint[]) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

function cropCanvas(source: HTMLCanvasElement, sx: number, sy: number, sw: number, sh: number): HTMLCanvasElement {
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

async function labelClosedShape(shape: DetectedShape, sourceCanvas: HTMLCanvasElement): Promise<DetectedShape> {
  const box = boundingBox(shape.points);
  const w = (box.maxX - box.minX) * sourceCanvas.width;
  const h = (box.maxY - box.minY) * sourceCanvas.height;
  // Inset by a fraction of the box's own size — this is the actual fix,
  // not a tuning nicety: OCR-ing right up to a plot's boundary reliably
  // misreads the boundary stroke itself as text.
  const insetX = w * 0.15;
  const insetY = h * 0.15;
  const sw = w - insetX * 2;
  const sh = h - insetY * 2;
  if (sw < 8 || sh < 8) return shape; // too small to meaningfully crop/OCR

  const crop = cropCanvas(sourceCanvas, box.minX * sourceCanvas.width + insetX, box.minY * sourceCanvas.height + insetY, sw, sh);

  let result: OcrCropResult;
  try {
    result = await recognizeCrop(crop);
  } catch {
    return shape;
  }
  if (!result.text || result.confidence < MIN_CONFIDENCE) return shape;

  for (const { pattern, kind, label } of FEATURE_KEYWORDS) {
    if (pattern.test(result.text)) {
      return { ...shape, kind: "feature", featureKind: kind, label, status: undefined };
    }
  }
  return { ...shape, label: result.text.split(/\s+/)[0] };
}

async function labelRoad(shape: DetectedShape, sourceCanvas: HTMLCanvasElement): Promise<DetectedShape> {
  const a = shape.points[0];
  const b = shape.points[shape.points.length - 1];
  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2;
  // A road has no interior to crop — this just samples a fixed-size box
  // around its midpoint, where a width label is commonly written next to
  // the line on a real site plan.
  const boxW = sourceCanvas.width * 0.14;
  const boxH = sourceCanvas.height * 0.07;
  const crop = cropCanvas(sourceCanvas, midX * sourceCanvas.width - boxW / 2, midY * sourceCanvas.height - boxH / 2, boxW, boxH);

  let result: OcrCropResult;
  try {
    result = await recognizeCrop(crop);
  } catch {
    return shape;
  }
  if (!result.text || result.confidence < MIN_CONFIDENCE) return shape;
  const numberMatch = result.text.match(ROAD_NUMBER);
  return numberMatch ? { ...shape, label: `${numberMatch[1]} ft` } : shape;
}

export async function labelShapesWithOcr(shapes: DetectedShape[], sourceCanvas: HTMLCanvasElement): Promise<DetectedShape[]> {
  const results: DetectedShape[] = [];
  for (const shape of shapes) {
    results.push(shape.kind === "road" ? await labelRoad(shape, sourceCanvas) : await labelClosedShape(shape, sourceCanvas));
  }
  return results;
}
