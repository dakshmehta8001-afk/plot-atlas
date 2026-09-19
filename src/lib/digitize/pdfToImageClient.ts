// Renders a PDF's first page to a real <canvas> entirely in the browser —
// deliberately separate from src/lib/pdfToImage.ts, which does the
// equivalent job server-side (using @napi-rs/canvas, a native binary) for
// the existing plan-image upload flow. This feature's whole pipeline
// (OpenCV, Tesseract) runs client-side, so PDF rendering needs to as well;
// a browser <canvas> is a standard Web API, no native binary needed here.
//
// Uses pdfjs-dist's plain browser entrypoint (`pdfjs-dist`, which resolves
// to build/pdf.mjs) rather than the `legacy/build/pdf.mjs` Node entrypoint
// pdfToImage.ts imports — that's the one difference between the two files;
// everything else about calling pdfjs is the same across both.
//
// The worker script is served from a plain static path (public/pdf.worker.
// min.mjs, copied from node_modules/pdfjs-dist/build/pdf.worker.min.mjs) —
// rather than the `new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.
// meta.url)` asset-module pattern some setups use, which is known to be
// finicky across pdfjs-dist/bundler version combinations. A committed static
// copy is less elegant (needs re-copying if pdfjs-dist is ever upgraded) but
// is guaranteed to resolve the same way regardless of bundler behavior.
import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

// Cap matches imagePrep.ts's resize step — no reason to rasterize a PDF
// bigger than the resolution the detection pipeline will immediately
// downscale to.
const MAX_EDGE_PX = 1600;

export async function renderPdfFirstPageToCanvas(
  file: File,
): Promise<{ canvas: HTMLCanvasElement; width: number; height: number }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
  const page = await doc.getPage(1);

  const nativeViewport = page.getViewport({ scale: 1 });
  const scale = MAX_EDGE_PX / Math.max(nativeViewport.width, nativeViewport.height);
  const viewport = page.getViewport({ scale: Math.max(scale, 0.1) });

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create a 2D canvas context to render the PDF.");

  await page.render({ canvasContext: context, canvas, viewport }).promise;

  return { canvas, width: canvas.width, height: canvas.height };
}
