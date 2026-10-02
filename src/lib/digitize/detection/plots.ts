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
//
// minAreaFraction raised from 0.0002 to 0.0006 after live testing against
// a real high-resolution clean-vector site plan (Naman Infracity) revealed
// it was letting individual plot-NUMBER TEXT CHARACTERS through as if they
// were tiny plots — a bold digit glyph forms a small, high-solidity closed
// contour that clears every other filter easily. This was the SECONDARY
// fix, though: the PRIMARY bug (found via the same test, and worth far
// more than this threshold bump on its own) was in suppressOverlapping()
// below, which was silently swallowing genuine individual plots whenever
// their bounding box fell inside a larger valid contour's box (an outer
// site boundary, a commercial block outline) — an everyday situation for
// any site plan, not an edge case. Fixing that alone took this real plan
// from 42 detected shapes (mostly text fragments) to 220 (correct plots +
// leftover text noise); this threshold bump on top of that fix is what
// then cleanly excludes the remaining text-sized noise, landing at 115 —
// close to the real ~103 plots this specific plan has. Verified this does
// NOT regress the real photographed BALAJI VIHAR test case this threshold
// was originally loosened for: re-tested at each candidate value and it
// held at a healthy, smoothly-varying count (not a cliff), actually
// slightly higher post-fix (42) than the original pre-fix baseline (38).
export const DEFAULT_PLOT_OPTIONS: PlotDetectionOptions = {
  minAreaFraction: 0.0006,
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

    // Circularity (isoperimetric quotient: 1.0 for a perfect circle, ~0.79
    // for a square, lower still for any more elongated rectangle) — a real
    // plot is built from straight boundary walls and is never this round,
    // but a compass rosette's own ring is exactly this shape, and (unlike
    // every other false "plot" this file filters) dodges every other
    // check here: it's small (not oversized), perfectly square in bbox
    // (not elongated), and highly solid (a circle IS already convex).
    // Found necessary via direct testing against a synthetic plan with
    // known ground truth: a compass ring was the one false "plot" of 20
    // that survived the area/aspect-ratio/vertex-count fixes above.
    const circularity = perimeter > 0 ? (4 * Math.PI * area) / (perimeter * perimeter) : 0;
    const MAX_CIRCULARITY = 0.9;
    if (circularity > MAX_CIRCULARITY) {
      contour.delete();
      continue;
    }

    const approx = new cv.Mat();
    cv.approxPolyDP(contour, approx, 0.02 * perimeter, true);

    const vertexCount = approx.rows;
    // >= 3 (not 4): real layouts routinely have triangular corner plots —
    // excluding them outright was an oversight in the original thresholds,
    // not a deliberate choice. Upper bound tightened from 14 to 10 after
    // direct testing against a synthetic plan with known ground truth: a
    // stylized, bold, drop-shadowed title ("RESIDENTIAL PLOT LAYOUT PLAN")
    // simplifies to 12-14 vertices per word, well above anything a real
    // plot (quadrilateral, occasionally an irregular 5-8 sided corner lot)
    // ever produced across every test image checked, including every real
    // plot on both real scanned plans used throughout this project.
    if (vertexCount < 3 || vertexCount > 10) {
      contour.delete();
      approx.delete();
      continue;
    }

    // Bounding-box aspect ratio — a real plot, even an irregular corner
    // lot, is never this elongated. A thin strip this shape is instead a
    // road-width text badge, a caption line, or a scale-bar tick, all of
    // which otherwise look plot-like (small, reasonably solid, low vertex
    // count). Found necessary via direct testing against the same
    // synthetic plan: 11 of its 20 false "plot" detections were exactly
    // this shape (6:1 to 17:1 width:height), none anywhere near a real
    // plot's own proportions.
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (let v = 0; v < vertexCount; v++) {
      const x = approx.data32S[v * 2];
      const y = approx.data32S[v * 2 + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const boxW = maxX - minX;
    const boxH = maxY - minY;
    const MAX_ASPECT_RATIO = 5;
    if (boxW <= 0 || boxH <= 0 || Math.max(boxW / boxH, boxH / boxW) > MAX_ASPECT_RATIO) {
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
  for (const candidate of suppressOverlapping(excludeOversizedOutliers(candidates))) {
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
//
// A real, previously-undiscovered bug lived here, found via live testing
// against a real high-resolution site plan: the containment check alone
// (intersection / thisBoxArea > 0.75) fires just as confidently for "a
// small plot's bounding box happens to sit entirely inside a much bigger
// shape's bounding box" as it does for a genuine inner/outer stroke-edge
// pair — and the former is an ORDINARY situation for any site plan with an
// outer boundary, a commercial block outline, or any other large contour
// that legitimately contains smaller ones spatially, not a rare edge case.
// On the real plan this surfaced on, one large valid contour (the site's
// outer frame) was silently swallowing every individual plot whose
// bounding box fell inside it, since sorting by size descending processes
// the frame first and then marks every smaller, entirely-unrelated plot
// underneath it as a "duplicate". A genuine inner/outer edge pair differs
// only by stroke width — their areas are close (ratio commonly 0.5-0.99
// even for a chunky relative stroke) — while a plot inside an outer frame
// differs by orders of magnitude (ratio well under 0.1 in practice). The
// added SIZE_RATIO_MIN check is what actually distinguishes them; the
// containment check alone never could.
const SIZE_RATIO_MIN = 0.4;

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
  const kept: { candidate: Candidate; box: ReturnType<typeof boundingBoxOf>; boxArea: number }[] = [];

  for (const candidate of sorted) {
    const box = boundingBoxOf(candidate.points);
    const boxArea = (box.maxX - box.minX) * (box.maxY - box.minY);
    const isDuplicate = kept.some(({ box: keptBox, boxArea: keptBoxArea }) => {
      const ix = Math.max(0, Math.min(box.maxX, keptBox.maxX) - Math.max(box.minX, keptBox.minX));
      const iy = Math.max(0, Math.min(box.maxY, keptBox.maxY) - Math.max(box.minY, keptBox.minY));
      const intersection = ix * iy;
      // Containment ratio (intersection / this box's own area), not IoU —
      // deliberately: an inner stroke edge's box is fully swallowed by the
      // outer edge's slightly larger box, which containment catches
      // cleanly even when the two boxes aren't quite the same size. The
      // size-ratio check alongside it is what keeps this from also
      // catching "a genuinely different, much smaller shape that happens
      // to sit inside a much bigger one" — see the comment above.
      const contained = boxArea > 0 && intersection / boxArea > 0.75;
      const similarSize = keptBoxArea > 0 && boxArea / keptBoxArea > SIZE_RATIO_MIN;
      return contained && similarSize;
    });
    if (!isDuplicate) kept.push({ candidate, box, boxArea });
  }

  return kept.map((k) => k.candidate);
}

// Anything far above the plan's own typical plot size is far more likely a
// mis-detected whole-diagram outer frame or a per-block outer border than
// a real individual plot — both confirmed as real, direct false positives
// via testing against a synthetic plan with known ground truth (36 real
// plots; these two shape classes sat at ~13x and ~70x the real median plot
// area). A THIRD false positive found the same way — an open road
// surface's own uniform gray fill, at a more moderate ~8x the median — is
// deliberately NOT what this ratio is tuned against: it's a long, thin
// band (~7:1 width:height), already caught independently by the aspect
// ratio filter above regardless of area. That distinction matters because
// the ratio here was initially set to 6 (matching roads.ts's own
// excludeOversizedPlotOutliers) and found, via direct testing against a
// REAL plan, to be too tight: Naman Infracity's own Commercial Plot — a
// genuinely larger, legitimately real block, not a detection artifact —
// sits at ~7.2x that plan's own median plot area, which a 6x cutoff
// deleted outright. 6x and ~7.2x (a real plot) turned out to be too close
// to the ~8x a false road-band also produces to separate with one ratio;
// raised to 10x specifically because the aspect-ratio filter already
// handles the elongated false-positive case on its own, leaving this
// check free to use a safer margin for the near-square giant shapes
// (frame, block borders) it actually needs to catch.
const MAX_PLOT_AREA_OUTLIER_RATIO = 10;

function excludeOversizedOutliers(candidates: Candidate[]): Candidate[] {
  if (candidates.length < 4) return candidates; // too few for a median to mean anything
  const sortedAreas = candidates.map((c) => c.areaFraction).sort((a, b) => a - b);
  const median = sortedAreas[Math.floor(sortedAreas.length / 2)];
  if (median <= 0) return candidates;
  return candidates.filter((c) => c.areaFraction <= median * MAX_PLOT_AREA_OUTLIER_RATIO);
}
