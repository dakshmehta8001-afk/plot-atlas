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
import { detectPlotFaces } from "./detection/faceExtraction";
import { applyRoadAndPlotRules, detectRoadSegments, filterRoadsByConfidence } from "./detection/roads";
import { labelShapesWithOcr } from "./detection/ocrLabels";
import { fillSingleMissingPlotNumber } from "./detection/fillMissingPlotNumber";
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

      // Captured before disposal below — `resized` itself is deleted along
      // with every other tracked Mat, so its `.cols`/`.rows` getters can't
      // be read again after that point (an Emscripten binding throws
      // "cannot call ... getter on deleted object", not a silent undefined).
      const analysisWidth = resized.cols;
      const analysisHeight = resized.rows;

      // Plots run FIRST now — road detection's corridor pairing needs to
      // know which candidate edges are already accounted for as one
      // plot's own boundary (see roads.ts's pairBelongsToSinglePlot),
      // since a single plot's two opposite sides are otherwise
      // geometrically indistinguishable from a real road's two paired
      // boundaries: both are parallel, both have a real gap, both can
      // have a uniform interior. Only the plot-contour cross-reference
      // tells them apart.
      //
      // detectPlotFaces (planar-graph face extraction, faceExtraction.ts)
      // replaces the former findContours-based detectPlotContours here —
      // switched after direct side-by-side testing against both a
      // synthetic plan with known ground truth and real scanned plans
      // confirmed it fixes the standing T-junction limitation
      // findContours-based detection could never fully solve (adjacent
      // plots sharing a thin wall occasionally merging into one shape, no
      // matter how much post-hoc geometric filtering got added on top —
      // see plots.ts's own doc comments for that history). `contrasted` is
      // passed as its `gray` parameter specifically because its internal
      // oriented-edge-support check requires the SAME grayscale/contrast-
      // enhanced Mat `edges` was produced from (see
      // extractCandidateSegments' own doc comment) — not the earlier,
      // pre-denoise/contrast `gray` variable above. Awaited here (it also
      // does its own OCR-to-face association internally, unlike the old
      // synchronous contour approach), so the tracked Mats below stay alive
      // for its whole duration, not just the synchronous portion.
      setStage("detecting-plots");
      const plotFaceResult = await detectPlotFaces(cv, edges, contrasted, sourceCanvas, analysisWidth, analysisHeight);
      const plotShapes = plotFaceResult.shapes;

      setStage("detecting-roads");
      // Only NUMBERED plots are passed as "definitely a plot" for road
      // pairing. A blank face is often a piece of a road itself (plot walls
      // lining up across a road cut it into plot-sized cells), and letting
      // it count as a plot made roads.ts reject that road's own two edges
      // as "two sides of one plot" — confirmed on the synthetic fixture,
      // where the whole centre road went undetected because of it.
      const roadShapes = detectRoadSegments(
        cv,
        edges,
        contrasted,
        analysisWidth,
        analysisHeight,
        plotShapes.filter((s) => s.label),
      );

      owned.forEach((m) => m.delete());

      setStage("reading-labels");
      // OCR reads each shape's OWN cropped interior (from the full-resolution
      // sourceCanvas, for the sharpest possible crop) rather than one pass
      // over the whole image — see ocrWorker.ts's doc comment for why a
      // whole-image pass reliably misread everything as garbage, confirmed
      // via extensive isolated testing, not assumed.
      let shapes = [...plotShapes, ...roadShapes];
      let ocrFailed = false;
      let rejectedNonPlotCount = 0;
      try {
        const outcome = await labelShapesWithOcr(shapes, sourceCanvas);
        shapes = outcome.shapes;
        rejectedNonPlotCount = outcome.rejectedCount;
      } catch (ocrErr) {
        // OCR failing shouldn't block the whole pipeline — the reviewer
        // just gets unlabeled shapes to fill in by hand instead of a hard
        // failure with nothing to show for it.
        console.error("OCR failed:", ocrErr);
        ocrFailed = true;
      }

      // A road candidate cleared the GEOMETRIC bar in detectRoadSegments,
      // but OCR (just run, above) may or may not have found supporting
      // road-keyword text to boost it — this is where a still-weak
      // candidate with no textual support either actually gets dropped,
      // rather than shown to the reviewer as a confident auto-detection.
      // Plots/features are untouched (the filter is a no-op for them).
      shapes = filterRoadsByConfidence(shapes);
      // Road/plot definitions applied to the final set: roads must run
      // between plots, one road is one road, a road piece is never a plot
      // (see applyRoadAndPlotRules). After the confidence filter, so only
      // roads we're actually keeping can affect plots.
      shapes = applyRoadAndPlotRules(shapes, analysisWidth, analysisHeight);
      const filled = fillSingleMissingPlotNumber(shapes);
      shapes = filled.shapes;

      setStage("building-map");

      const warnings: string[] = [];
      // Checked against the FINAL shapes list, not the pre-filter
      // roadShapes count — a road candidate can clear the geometric bar in
      // detectRoadSegments and still get dropped by filterRoadsByConfidence
      // just above if OCR found no supporting text either, so roadShapes
      // itself is no longer the right thing to check here.
      if (plotShapes.length === 0 && !shapes.some((s) => s.kind === "road")) {
        warnings.push(
          "No plot or road boundaries were detected automatically — use Draw Plot/Draw Road to trace them by hand, or retry with a straighter, better-lit photo.",
        );
      }
      if (ocrFailed || shapes.every((s) => !s.label)) {
        warnings.push("No readable text was found — plot numbers and road widths will need to be entered manually.");
      }
      if (filled.note) warnings.push(filled.note);
      if (rejectedNonPlotCount > 0) {
        warnings.push(
          `Excluded ${rejectedNonPlotCount} shape${rejectedNonPlotCount === 1 ? "" : "s"} that looked like a legend, distance table, or title/compass text rather than a real plot — double-check nothing real was skipped.`,
        );
      }
      // detectPlotFaces' own warnings — ambiguous plot-number associations,
      // duplicate labels, faces excluded as a road corridor/legend area —
      // surfaced the same way every other detection-quality signal here
      // already is, never silently dropped.
      warnings.push(...plotFaceResult.warnings);

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

// Loads a project's ALREADY-UPLOADED plan_image_url directly into a canvas —
// used so a sub-admin who uploaded their plan at project-creation time (or
// via PlanImageUpload afterward) isn't asked to pick the SAME file again
// just to run auto-digitize on it. `crossOrigin = "anonymous"` is required
// here specifically (loadFileToCanvas above never needs it, since an
// object: URL is always same-origin): without it, a cross-origin image
// (Supabase Storage is a different origin from the app) taints the canvas,
// and every later pixel read this pipeline depends on (OpenCV's cv.imread,
// toDataURL for the review canvas, toBlob when re-saving) throws a
// SecurityError instead of failing quietly — confirmed safe to set
// unconditionally since plot-atlas's plan-images bucket is public-read with
// CORS already open for the same reason the public site viewers can already
// load this exact URL cross-origin via a plain <img>.
export async function loadUrlToCanvas(url: string): Promise<HTMLCanvasElement> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  const loaded = await new Promise<HTMLImageElement>((resolve, reject) => {
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load the saved plan image — it may have been moved or deleted."));
    img.src = url;
  });
  const longEdge = Math.max(loaded.naturalWidth, loaded.naturalHeight);
  const scale = Math.min(1, MAX_SOURCE_EDGE_PX / longEdge);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(loaded.naturalWidth * scale);
  canvas.height = Math.round(loaded.naturalHeight * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create a 2D canvas context.");
  ctx.drawImage(loaded, 0, 0, canvas.width, canvas.height);
  return canvas;
}
