// Finds plot-like CLOSED shapes in an edge map (detection/edges.ts's
// autoCanny output). Deliberately has no idea how many plots a layout
// "should" have — every candidate is judged purely on its own geometry
// (area relative to the whole image, vertex count after simplification,
// and solidity), which is what lets this generalize across layouts with
// wildly different plot counts and shapes rather than assuming a fixed
// grid.
//
// An adaptive-threshold-plus-dilation alternative to Canny was tried here
// (on the theory that adaptive threshold holds onto thin uniform-width
// CAD-style lines better than gradient-based edge detection) and reverted
// after real testing showed it performing WORSE on every existing test
// case — more merged blobs, not fewer. Noted so a future attempt at the
// same idea starts from "this was tried and measured, not just assumed
// to help" rather than re-discovering the same dead end.
import type { PolygonPoint } from "@/lib/types";
import type { Cv } from "../opencvLoader";
import type { DetectedShape } from "../types";

export interface PlotDetectionOptions {
  /** Reject contours smaller than this fraction of the total image area — filters out noise specks. */
  minAreaFraction: number;
  /** Reject contours larger than this fraction — filters out the page border/whole-image false "plot". */
  maxAreaFraction: number;
  /** contourArea / convexHullArea must clear this to be considered a clean-enough boundary, not noisy/self-intersecting. */
  minSolidity: number;
}

// Loosened from an initial pass tuned only against a clean, bold-stroke
// synthetic test image — a real scanned/photographed plan has thinner,
// sometimes dashed/dotted lines and imperfectly-traced (slightly concave
// after simplification, or triangular) plots, which the original stricter
// thresholds rejected outright (confirmed against a real user-submitted
// scan: 0 plots detected at all under the original settings). Erring
// toward finding MORE candidates is the right tradeoff here — a false
// positive costs the reviewer one deletion; a false negative (a real plot
// never proposed at all) costs them tracing it from scratch, which is
// exactly the manual-tracer work this feature exists to reduce.
export const DEFAULT_PLOT_OPTIONS: PlotDetectionOptions = {
  minAreaFraction: 0.0002,
  maxAreaFraction: 0.4,
  minSolidity: 0.55,
};

export function detectPlotContours(
  cv: Cv,
  edges: unknown,
  imageWidth: number,
  imageHeight: number,
  options: PlotDetectionOptions = DEFAULT_PLOT_OPTIONS,
): DetectedShape[] {
  // A small morphological close bridges tiny gaps (scan noise, a slightly
  // broken line) in an otherwise-solid plot boundary — findContours needs a
  // genuinely closed loop to treat something as one shape. Kept deliberately
  // small (3x3): tried 5x5 first, on the theory that it would also help
  // with dashed/dotted boundary lines, but a real test caught a genuine
  // regression from that — it bridged the (already thin, and weaker still
  // after rasterizing at an angle) dividing walls between adjacent rotated
  // plots, fusing 4 separate plots into one blob. Dashed-line gaps are
  // handled separately and don't need this: road detection (detection/
  // roads.ts) runs HoughLinesP directly on the raw (non-closed) edge map,
  // with its own maxLineGap tolerance — this closing step was never
  // actually helping dashed roads, only plot boundaries, so shrinking it
  // back down costs nothing there.
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
  const closed = new cv.Mat();
  cv.morphologyEx(edges, closed, cv.MORPH_CLOSE, kernel);
  kernel.delete();

  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  // RETR_LIST, NOT RETR_EXTERNAL. This was a real, serious bug found via
  // direct testing (dumping the edge map and a per-contour rejection
  // breakdown against a real user-submitted plan, not assumed): a site
  // plan very commonly has an outer border/frame around the whole page —
  // RETR_EXTERNAL returns ONLY the outermost contour of each nesting
  // group, so with a full-page border present, it returns exactly ONE
  // contour (the border itself, correctly rejected by the area filter as
  // "too big to be a plot") and silently discards every actual plot
  // nested inside it — total detection failure, not a threshold problem,
  // confirmed by a real run logging `totalContours: 1`.
  //
  // RETR_LIST returns every contour regardless of nesting, so it doesn't
  // have this failure mode — the tradeoff is that a boundary drawn as a
  // stroke has both an inner and outer edge, which RETR_LIST surfaces as
  // two near-duplicate contours per plot. `suppressOverlapping` below
  // is the fix for THAT (a cheap non-max-suppression pass, keeping the
  // larger/outer one and dropping anything that heavily overlaps an
  // already-kept shape) — deliberately applied AFTER filtering, not by
  // switching retrieval mode again, since missing real plots is a far
  // worse failure than a few duplicates the reviewer has to delete.
  cv.findContours(closed, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
  closed.delete();
  hierarchy.delete();

  const totalArea = imageWidth * imageHeight;
  const candidates: Candidate[] = [];

  for (let i = 0; i < contours.size(); i++) {
    const contour = contours.get(i);
    const area = cv.contourArea(contour);
    const areaFraction = area / totalArea;

    if (areaFraction < options.minAreaFraction || areaFraction > options.maxAreaFraction) {
      contour.delete();
      continue;
    }

    const hull = new cv.Mat();
    cv.convexHull(contour, hull);
    const hullArea = cv.contourArea(hull);
    const solidity = hullArea > 0 ? area / hullArea : 0;
    hull.delete();

    if (solidity < options.minSolidity) {
      contour.delete();
      continue;
    }

    // approxPolyDP's epsilon is relative to the contour's own perimeter
    // (not a fixed pixel count) so it simplifies a small plot and a huge
    // one by the same PROPORTION of detail, rather than over-simplifying
    // small contours or under-simplifying large ones with one fixed number.
    const perimeter = cv.arcLength(contour, true);
    const approx = new cv.Mat();
    cv.approxPolyDP(contour, approx, 0.02 * perimeter, true);

    const vertexCount = approx.rows;
    // >= 3 (not 4): real layouts routinely have triangular corner plots —
    // excluding them outright was an oversight in the original thresholds,
    // not a deliberate choice.
    if (vertexCount < 3 || vertexCount > 14) {
      contour.delete();
      approx.delete();
      continue;
    }

    const points: PolygonPoint[] = [];
    for (let v = 0; v < vertexCount; v++) {
      points.push({
        x: approx.data32S[v * 2] / imageWidth,
        y: approx.data32S[v * 2 + 1] / imageHeight,
      });
    }

    candidates.push({ points, areaFraction, solidity, vertexCount });

    contour.delete();
    approx.delete();
  }

  contours.delete();

  const shapes: DetectedShape[] = [];
  for (const candidate of suppressOverlapping(candidates)) {
    // A rough, purely-geometric confidence hint for the review UI (e.g. a
    // dashed outline on low-confidence shapes) — how comfortably this
    // contour clears the thresholds above. Never persisted, never shown as
    // a claim of real accuracy.
    const areaScore = Math.min(
      1,
      (Math.min(candidate.areaFraction - options.minAreaFraction, options.maxAreaFraction - candidate.areaFraction) /
        (options.maxAreaFraction - options.minAreaFraction)) *
        4,
    );
    const vertexScore = candidate.vertexCount >= 4 && candidate.vertexCount <= 6 ? 1 : 0.6;
    const confidence = Math.max(0, Math.min(1, candidate.solidity * 0.5 + Math.max(0, areaScore) * 0.3 + vertexScore * 0.2));

    shapes.push({
      localId: crypto.randomUUID(),
      kind: "plot",
      points: candidate.points,
      label: "",
      status: "available",
      confidence,
      source: "detected",
      // Nothing is computed yet at detection time — there's no project
      // calibration available this early in the pipeline (that's set by
      // the reviewer afterward). DigitizeWorkspace recomputes this
      // correctly (and dimensions/areaSqft alongside it) the moment
      // calibration exists, same as it does for every other plot.
      needsDimensionReview: true,
    });
  }

  return shapes;
}

function boundingBoxOf(points: PolygonPoint[]) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

// Non-max suppression for the inner/outer duplicate contours RETR_LIST
// produces for a single stroked boundary (see the findContours comment
// above for why RETR_LIST is used despite this cost). Two contours from
// the same stroke have near-identical bounding boxes; two genuinely
// different adjacent plots don't, even when they share a wall, since a
// shared wall is a shared EDGE, not a heavily overlapping interior. Kept
// deliberately simple (bounding-box containment, not true polygon
// intersection) — good enough to distinguish "same stroke, two edges" from
// "two different plots" without adding real geometry-library complexity.
interface Candidate {
  points: PolygonPoint[];
  areaFraction: number;
  solidity: number;
  vertexCount: number;
}

function suppressOverlapping(candidates: Candidate[]): Candidate[] {
  // Larger first: between a stroke's inner and outer edge, the outer one
  // (larger) more accurately represents the plot's real boundary.
  const sorted = [...candidates].sort((a, b) => b.areaFraction - a.areaFraction);
  const kept: { candidate: Candidate; box: ReturnType<typeof boundingBoxOf> }[] = [];

  for (const candidate of sorted) {
    const box = boundingBoxOf(candidate.points);
    const boxArea = (box.maxX - box.minX) * (box.maxY - box.minY);
    const isDuplicate = kept.some(({ box: keptBox }) => {
      const ix = Math.max(0, Math.min(box.maxX, keptBox.maxX) - Math.max(box.minX, keptBox.minX));
      const iy = Math.max(0, Math.min(box.maxY, keptBox.maxY) - Math.max(box.minY, keptBox.minY));
      const intersection = ix * iy;
      // Containment ratio (intersection / this box's own area), not IoU —
      // deliberately: an inner stroke edge's box is fully swallowed by the
      // outer edge's slightly larger box, which containment catches
      // cleanly even when the two boxes aren't quite the same size.
      return boxArea > 0 && intersection / boxArea > 0.75;
    });
    if (!isDuplicate) kept.push({ candidate, box });
  }

  return kept.map((k) => k.candidate);
}
