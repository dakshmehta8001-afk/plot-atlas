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
//
// Reads a small CROPPED region per detected shape (see detection/ocrLabels.ts)
// rather than one OCR pass over the whole plan image. That wasn't a minor
// tuning choice — it's the fix for a real bug found via extensive isolated
// testing: running OCR on the whole image, or on a shape's crop with the
// default AUTO or SPARSE_TEXT page-segmentation mode, consistently
// misread every label as short garbage strings (Tesseract's layout
// analysis appears to conflate plot-boundary border lines with text and/or
// fails to segment isolated large labels scattered across mostly-blank
// space). The SAME crop, OCR'd with PSM.SINGLE_BLOCK — "treat this as one
// block of text", the right assumption once we've already cropped down to
// just one shape's label — reads correctly at 90%+ confidence.
import { createWorker, OEM, PSM } from "tesseract.js";

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
    }).then(async (worker) => {
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
      return worker;
    });
  }
  return workerPromise;
}

export interface OcrCropResult {
  text: string;
  confidence: number;
}

// Recognizes a single small crop (one detected shape's interior, or a
// small box around a road's midpoint) and returns its best-guess text.
// Confidence gating (deciding whether a result is trustworthy enough to
// auto-fill) is the caller's job — see detection/ocrLabels.ts.
export async function recognizeCrop(canvas: HTMLCanvasElement): Promise<OcrCropResult> {
  const worker = await getWorker();
  const { data } = await worker.recognize(canvas, {}, { text: true });
  return { text: data.text.trim(), confidence: data.confidence };
}

export interface OcrWordResult {
  text: string;
  confidence: number;
  /** Pixel coordinates WITHIN the crop passed in — same convention Tesseract itself returns, not remapped to any larger image. Callers that OCR a crop taken from a bigger canvas (e.g. detection/faceExtraction.ts, one crop per graph face) are responsible for adding their own crop offset back in if they need a full-image coordinate. */
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

// Same worker/crop/PSM.SINGLE_BLOCK discipline as recognizeCrop above (see
// this file's top doc comment for why that discipline exists at all) — the
// only difference is requesting Tesseract's hierarchical `blocks` output so
// each individual WORD's own bounding box comes back, not just one
// best-guess string for the whole crop. Needed by face-extraction's
// OCR-center-in-polygon plot-number association (detection/faceExtraction.ts):
// unlike the single-shape-crop labeling this file was originally built for
// (where "whatever text is in this shape's crop" was always safe to treat as
// one label), a graph face's crop can legitimately contain more than one
// piece of text near its edges, so the caller needs each word's own position
// to decide which face it actually belongs to, not just "the crop's text".
export async function recognizeCropWords(canvas: HTMLCanvasElement): Promise<OcrWordResult[]> {
  const worker = await getWorker();
  const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
  const words: OcrWordResult[] = [];
  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        for (const word of line.words) {
          const text = word.text.trim();
          if (text) words.push({ text, confidence: word.confidence, bbox: word.bbox });
        }
      }
    }
  }
  return words;
}
