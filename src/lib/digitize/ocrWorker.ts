// Tesseract.js OCR, configured to load ONLY from files under public/tesseract
// (see public/tesseract/README.md for exactly where each one came from) —
// by default Tesseract.js fetches its worker script, WASM core, and
// language trained-data from jsdelivr's CDN, which would silently violate
// this feature's "no cloud dependency at runtime" requirement if left
// unconfigured. `corePath`/`langPath` are directories, not files: Tesseract
// picks one of several core variants (plain/simd/relaxedsimd) at runtime
// based on the browser's WASM feature support, and appends `${lang}.
// traineddata.gz` to langPath itself — see getCore.js/worker-script/index.js
// in node_modules/tesseract.js for exactly how those paths get built.
import { createWorker, OEM } from "tesseract.js";
import type { PolygonPoint } from "@/lib/types";

export interface OcrWord {
  text: string;
  confidence: number;
  /** Fractional (0..1) center of the word's bounding box, in the SAME coordinate space as everything else in this app (relative to the image OCR ran on). */
  center: PolygonPoint;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let workerPromise: Promise<any> | null = null;

function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker("eng", OEM.LSTM_ONLY, {
      workerPath: "/tesseract/worker.min.js",
      corePath: "/tesseract/core",
      langPath: "/tesseract/lang-data",
      gzip: true,
      cacheMethod: "none",
    });
  }
  return workerPromise;
}

// Runs OCR over a full plan image and returns every recognized word's text,
// confidence, and center point — matching a word to the nearest detected
// shape (detection/ocrMatch.ts) is the caller's job, not this module's.
export async function recognizeWords(
  image: HTMLCanvasElement,
  imageWidth: number,
  imageHeight: number,
): Promise<OcrWord[]> {
  const worker = await getWorker();
  const { data } = await worker.recognize(image, {}, { blocks: true });

  const words: OcrWord[] = [];
  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        for (const word of line.words ?? []) {
          if (!word.text.trim()) continue;
          words.push({
            text: word.text.trim(),
            confidence: word.confidence,
            center: {
              x: (word.bbox.x0 + word.bbox.x1) / 2 / imageWidth,
              y: (word.bbox.y0 + word.bbox.y1) / 2 / imageHeight,
            },
          });
        }
      }
    }
  }
  return words;
}
