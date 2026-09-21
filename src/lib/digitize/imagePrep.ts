// Preprocessing stages shared by every detection step, in the order the
// pipeline runs them: resize → grayscale → denoise → contrast enhancement.
// Each function takes and returns an OpenCV `Mat` — callers own the Mats
// they get back and must `.delete()` them when done (see useDetectionPipeline.ts,
// which owns the full chain's lifetime and disposes everything at the end).
// This isn't garbage-collected memory — it's the WASM heap OpenCV.js
// manages itself, so a leaked Mat stays leaked for the rest of the page's
// life.
import type { Cv } from "./opencvLoader";

// No fixed expected input size: every uploaded plan is capped to the same
// long-edge size before detection so contour/line thresholds tuned in pixel
// space behave consistently regardless of the source photo's resolution,
// and so a large scanned image doesn't make Canny/findContours slow. Because
// this uniformly scales both dimensions, a point's FRACTION of the resized
// image's width/height is identical to its fraction of the original image's
// width/height — which is exactly the coordinate contract every detected
// shape needs to satisfy (see src/lib/types.ts's PolygonPoint doc comment).
// Raised from 1600: real-world testing against an actual user-submitted
// plan (a vector-style CAD layout with hairline-thin dividing walls between
// tightly-packed plots) showed the internal boundary lines becoming too
// faint to survive edge detection at all after downscaling that far —
// the whole plot cluster merged into one shape instead of dozens of
// separate ones. More analysis pixels per line directly helps a thin line
// survive resize/blur/Canny with enough contrast left to trace.
export const MAX_EDGE_PX = 2200;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function resizeToMaxEdge(cv: Cv, src: any, maxEdge = MAX_EDGE_PX): any {
  const longEdge = Math.max(src.rows, src.cols);
  if (longEdge <= maxEdge) return src.clone();
  const scale = maxEdge / longEdge;
  const dst = new cv.Mat();
  cv.resize(src, dst, new cv.Size(0, 0), scale, scale, cv.INTER_AREA);
  return dst;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toGrayscale(cv: Cv, src: any): any {
  const dst = new cv.Mat();
  cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY);
  return dst;
}

// Bilateral filter over a plain Gaussian blur: it smooths out photo noise
// and paper texture while keeping the plot/road LINES themselves sharp,
// which matters more here than in most denoising use cases — a blurred
// line is a line findContours/HoughLinesP can miss entirely.
//
// Kept deliberately gentle (d=5, not the initially-tried d=9): a real test
// against an actual scanned/vector-rendered plan with hairline-thin
// dividing walls showed even bilateral filtering's edge-preserving blur
// softening those specific lines enough to break edge detection — a 9px
// filter diameter is large relative to a 1px line. This plan format (a
// vector CAD layout rasterized to an image, not a grainy phone photo) has
// little real photographic noise to remove in the first place, so erring
// toward a lighter touch costs little for genuinely noisy photos while
// meaningfully helping thin-line preservation for cleaner scans.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function denoise(cv: Cv, gray: any): any {
  const dst = new cv.Mat();
  cv.bilateralFilter(gray, dst, 5, 40, 40, cv.BORDER_DEFAULT);
  return dst;
}

// CLAHE (contrast-limited adaptive histogram equalization) rather than plain
// global histogram equalization — a photographed paper plan is often lit
// unevenly (a shadow across half the page is common), and CLAHE handles
// that per-tile instead of stretching contrast uniformly across the whole
// image based on one global brightness distribution.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function enhanceContrast(cv: Cv, gray: any): any {
  const dst = new cv.Mat();
  const clahe = new cv.CLAHE(2.0, new cv.Size(8, 8));
  clahe.apply(gray, dst);
  clahe.delete();
  return dst;
}
