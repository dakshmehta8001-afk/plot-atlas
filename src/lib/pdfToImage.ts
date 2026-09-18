// Converts a PDF's first page to a PNG buffer, server-side, so a sub-admin
// can upload a PDF plan (a common export from CAD/architecture software)
// and have it stored/rendered the same way as any other plan image. The
// public/dashboard viewers render plan images via an SVG <image> element,
// which browsers can display for JPG/PNG/WebP/SVG but never for a raw PDF —
// so a PDF must be rasterized here before it's ever stored, rather than
// uploaded as-is and hoping the browser can show it later.
//
// pdfjs-dist (Mozilla's PDF renderer) needs a few browser globals it
// otherwise assumes exist (DOMMatrix, ImageData, Path2D) — @napi-rs/canvas
// ships compatible implementations of exactly these, specifically so it can
// stand in as pdfjs's rendering surface in Node. @napi-rs/canvas is used
// (rather than the older `canvas` package) because it ships prebuilt native
// binaries for the platforms this app actually runs on — the local Windows
// dev machine and Vercel's Linux serverless functions — without needing a
// C++ build toolchain at install time.
import { createCanvas, DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";

// @napi-rs/canvas's DOMMatrix/ImageData/Path2D are runtime-compatible with
// what pdfjs-dist expects, but their TypeScript types don't structurally
// match lib.dom.d.ts's browser versions (different property lists) — this
// is a known mismatch for this exact library combination, not a real type
// error, so the polyfill assignment goes through `any` rather than fighting
// the type checker over types that were never meant to unify.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;
g.DOMMatrix ??= DOMMatrix;
g.ImageData ??= ImageData;
g.Path2D ??= Path2D;

// Upscaled 2x from the PDF's native point size (72 DPI) so the rasterized
// image has enough resolution to still look sharp once a viewer zooms in —
// plan images get zoomed 3-4x when a plot/building is clicked.
const RENDER_SCALE = 2;

export async function renderPdfFirstPageToPng(pdfBytes: Uint8Array): Promise<{
  buffer: Buffer;
  width: number;
  height: number;
}> {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const doc = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: RENDER_SCALE });

  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext("2d");

  // pdfjs's RenderParameters type doesn't line up 1:1 with @napi-rs/canvas's
  // canvas/context types, but the subset it actually calls at runtime is
  // compatible — see the DOMMatrix/ImageData/Path2D note above.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.render({ canvasContext: context as any, canvas: canvas as any, viewport }).promise;

  return {
    buffer: canvas.toBuffer("image/png"),
    width: canvas.width,
    height: canvas.height,
  };
}

export function isPdf(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}
