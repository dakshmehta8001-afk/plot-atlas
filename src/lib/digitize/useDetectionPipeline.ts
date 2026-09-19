"use client";

// Orchestrates the full upload → detect pipeline and exposes the staged
// progress the user sees ("Preparing image...", "Detecting roads...", ...).
// This is the one place that owns OpenCV Mat lifetimes end to end — every
// intermediate Mat created while preparing/detecting is tracked and
// disposed together once detection is done, since OpenCV.js's WASM heap
// isn't garbage collected.
import { useCallback, useState } from "react";
import { loadOpenCv, type Cv } from "./opencvLoader";
import { denoise, enhanceContrast, MAX_EDGE_PX, resizeToMaxEdge, toGrayscale } from "./imagePrep";
import { autoCanny } from "./detection/edges";
import { detectPlotContours } from "./detection/plots";
import { detectRoadSegments } from "./detection/roads";
import { matchOcrToShapes } from "./detection/ocrMatch";
import { recognizeWords } from "./ocrWorker";
import { renderPdfFirstPageToCanvas } from "./pdfToImageClient";
import type { DetectionResult, PipelineStage } from "./types";

interface RunInput {
  /** A freshly uploaded file (image or PDF). */
  file?: File;
  /** An already-prepared source image — used when the reviewer ran CornerWarpTool's perspective correction first, so detection runs on the corrected image instead of the raw upload. */
  canvas?: HTMLCanvasElement;
}

export interface PipelineOutcome {
  result: DetectionResult;
  /** The full-resolution source image to keep as the plan image (never downscaled — only the analysis copy is, for speed and threshold stability). */
  sourceCanvas: HTMLCanvasElement;
}

export function useDetectionPipeline() {
  const [stage, setStage] = useState<PipelineStage>("idle");
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (input: RunInput): Promise<PipelineOutcome | null> => {
    setError(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const owned: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const track = <T,>(m: T): T => {
      owned.push(m);
      return m;
    };

    try {
      setStage("loading-engine");
      const cv: Cv = await loadOpenCv();

      setStage("preparing");
      const sourceCanvas = input.canvas ?? (await loadFileToCanvas(input.file!));

      const original = track(cv.imread(sourceCanvas));
      const resized = track(resizeToMaxEdge(cv, original, MAX_EDGE_PX));
      const gray = track(toGrayscale(cv, resized));
      const denoised = track(denoise(cv, gray));
      const contrasted = track(enhanceContrast(cv, denoised));

      setStage("detecting-layout");
      const edges = track(autoCanny(cv, contrasted));

      setStage("detecting-roads");
      const roadShapes = detectRoadSegments(cv, edges, resized.cols, resized.rows);

      setStage("detecting-plots");
      const plotShapes = detectPlotContours(cv, edges, resized.cols, resized.rows);

      // OCR runs on the contrast-enhanced, already-resized copy (faster
      // than the full-resolution original, and the contrast step generally
      // helps Tesseract more than it hurts).
      const ocrCanvas = document.createElement("canvas");
      cv.imshow(ocrCanvas, contrasted);

      owned.forEach((m) => m.delete());

      setStage("reading-labels");
      let words: Awaited<ReturnType<typeof recognizeWords>> = [];
      try {
        words = await recognizeWords(ocrCanvas, resized.cols, resized.rows);
      } catch (ocrErr) {
        // OCR failing shouldn't block the whole pipeline — the reviewer
        // just gets unlabeled shapes to fill in by hand instead of a hard
        // failure with nothing to show for it.
        console.error("OCR failed:", ocrErr);
      }

      setStage("building-map");
      const shapes = matchOcrToShapes([...plotShapes, ...roadShapes], words);

      const warnings: string[] = [];
      if (plotShapes.length === 0 && roadShapes.length === 0) {
        warnings.push(
          "No plot or road boundaries were detected automatically — use Draw Plot/Draw Road to trace them by hand, or retry with a straighter, better-lit photo.",
        );
      }
      if (words.length === 0) {
        warnings.push("No readable text was found — plot numbers and road widths will need to be entered manually.");
      }

      setStage("done");
      return { result: { shapes, warnings }, sourceCanvas };
    } catch (err) {
      owned.forEach((m) => {
        try {
          m.delete();
        } catch {
          // Already disposed or never fully constructed — nothing more to clean up.
        }
      });
      console.error(err);
      setError(err instanceof Error ? err.message : "Detection failed unexpectedly.");
      setStage("error");
      return null;
    }
  }, []);

  function reset() {
    setStage("idle");
    setError(null);
  }

  return { stage, error, run, reset };
}

// A modern phone photo is easily 12+ megapixels — kept as-is, it would (a)
// make every downstream `toDataURL()` call in the review canvas multi-tens-
// of-MB, and (b) not add any real detection value anyway, since the
// analysis copy is downscaled further to MAX_EDGE_PX regardless. This cap
// is only for what stays on screen/gets saved as the plan image — high
// enough to still look sharp zoomed in, low enough to keep the browser tab
// comfortable. PDFs don't need a separate cap: they're rendered directly at
// MAX_EDGE_PX in pdfToImageClient.ts, since a vector PDF page looks equally
// crisp at any reasonable raster size.
const MAX_SOURCE_EDGE_PX = 2400;

// Exported so DigitizeWorkspace can build a preview canvas up front for
// CornerWarpTool (which needs something to display and tap corners on
// before detection itself ever runs) — the pipeline's own `run()` below
// reuses this same function when no pre-built canvas is passed in.
export async function loadFileToCanvas(file: File): Promise<HTMLCanvasElement> {
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (isPdf) {
    const { canvas } = await renderPdfFirstPageToCanvas(file);
    return canvas;
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImageElement(objectUrl);
    const longEdge = Math.max(img.naturalWidth, img.naturalHeight);
    const scale = Math.min(1, MAX_SOURCE_EDGE_PX / longEdge);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not create a 2D canvas context.");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new Error("Could not read that image file — it may be corrupted or an unsupported format."));
    img.src = src;
  });
}
