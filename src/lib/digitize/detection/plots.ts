// Finds plot-like CLOSED shapes in an edge map. Deliberately has no idea how
// many plots a layout "should" have — every candidate is judged purely on
// its own geometry (area relative to the whole image, vertex count after
// simplification, and solidity), which is what lets this generalize across
// layouts with wildly different plot counts and shapes rather than assuming
// a fixed grid.
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
  // A morphological close bridges the gaps a hand-drawn, dashed/dotted, or
  // slightly-blurred boundary line leaves in the edge map — findContours
  // needs a genuinely closed loop to treat something as one shape,  and a
  // real scanned plan's boundary lines are often thin and broken by scan
  // noise or an intentionally dashed/dotted line style (common for
  // "proposed road" or setback lines specifically). 5x5 rather than 3x3:
  // large enough to bridge a dashed line's actual gaps, still small enough
  // not to fuse two genuinely separate nearby plots into one blob.
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
  const closed = new cv.Mat();
  cv.morphologyEx(edges, closed, cv.MORPH_CLOSE, kernel);
  kernel.delete();

  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  // RETR_EXTERNAL (only outermost contours), not RETR_LIST — a boundary
  // drawn as a stroke has both an inner and outer edge, which RETR_LIST
  // would surface as two near-duplicate nested contours per real plot; it
  // would also pick up small stray contours from anything drawn INSIDE a
  // plot (e.g. its own number/text), which are never plot candidates
  // themselves. Confirmed empirically: RETR_LIST produced ~4x as many
  // "plot" candidates as actually existed in a real test image.
  cv.findContours(closed, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  closed.delete();
  hierarchy.delete();

  const totalArea = imageWidth * imageHeight;
  const shapes: DetectedShape[] = [];

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

    // A rough, purely-geometric confidence hint for the review UI (e.g. a
    // dashed outline on low-confidence shapes) — how comfortably this
    // contour clears the thresholds above. Never persisted, never shown as
    // a claim of real accuracy.
    const areaScore = Math.min(
      1,
      (Math.min(areaFraction - options.minAreaFraction, options.maxAreaFraction - areaFraction) /
        (options.maxAreaFraction - options.minAreaFraction)) *
        4,
    );
    const vertexScore = vertexCount >= 4 && vertexCount <= 6 ? 1 : 0.6;
    const confidence = Math.max(0, Math.min(1, solidity * 0.5 + Math.max(0, areaScore) * 0.3 + vertexScore * 0.2));

    shapes.push({
      localId: crypto.randomUUID(),
      kind: "plot",
      points,
      label: "",
      status: "available",
      confidence,
      source: "detected",
    });

    contour.delete();
    approx.delete();
  }

  contours.delete();
  return shapes;
}
