// Auto-Canny: derives Canny's two thresholds from the image's own median
// intensity instead of one fixed constant. Photographed site plans vary
// wildly in exposure (indoor vs outdoor light, phone auto-exposure, flash),
// so a fixed threshold that works for one photo routinely finds either no
// edges or solid noise on another — deriving it per-image is the standard
// fix for that (the 0.33 sigma below is the commonly-cited default for this
// technique, not tuned against any specific plan images of the user's).
import type { Cv } from "../opencvLoader";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function medianIntensity(cv: Cv, gray: any): number {
  const histSrc = new cv.MatVector();
  histSrc.push_back(gray);
  const hist = new cv.Mat();
  cv.calcHist(histSrc, [0], new cv.Mat(), hist, [256], [0, 256]);

  const total = gray.rows * gray.cols;
  let cumulative = 0;
  let median = 128;
  for (let i = 0; i < 256; i++) {
    cumulative += hist.floatAt(i, 0);
    if (cumulative >= total / 2) {
      median = i;
      break;
    }
  }
  hist.delete();
  histSrc.delete();
  return median;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function autoCanny(cv: Cv, gray: any, sigma = 0.33): any {
  const median = medianIntensity(cv, gray);
  const lower = Math.max(0, (1 - sigma) * median);
  const upper = Math.min(255, (1 + sigma) * median);
  const edges = new cv.Mat();
  cv.Canny(gray, edges, lower, upper);
  return edges;
}
