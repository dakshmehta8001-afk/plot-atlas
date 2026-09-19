"use client";

// JSON/SVG/PNG export of the in-progress (or already-saved) shape list.
// PDF export is deliberately not included — the user's own spec called it
// "if practical", and a from-scratch PDF export is lower value than the
// rest of this feature; a half-built one would be worse than none.
//
// The exported SVG is built directly from `shapes` data (not by serializing
// the live interactive canvas's DOM), so it's a clean, portable file with
// real per-plot `<polygon>` elements carrying data-plot-id/data-plot-number
// attributes — satisfying "the exported SVG must preserve the individual
// plot shapes", not just a flattened picture of them.
import { MAP_VIEWBOX_SIZE, SITE_FEATURE_STYLES, UNIT_STATUS_STYLES } from "@/lib/types";
import { toSvgPoints } from "@/lib/svgPolygon";
import type { DetectedShape } from "@/lib/digitize/types";

const VB = MAP_VIEWBOX_SIZE;

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function buildSvgMarkup(shapes: DetectedShape[]): string {
  const parts: string[] = [];
  for (const shape of shapes) {
    if (shape.points.length < 2) continue;
    const pts = toSvgPoints(shape.points);
    if (shape.kind === "road") {
      parts.push(`<polyline data-road-id="${shape.localId}" points="${pts}" fill="none" stroke="#f5c94b" stroke-width="${VB * 0.003}" />`);
    } else if (shape.kind === "feature") {
      const style = SITE_FEATURE_STYLES[shape.featureKind ?? "other"];
      parts.push(
        `<polygon data-feature-id="${shape.localId}" data-label="${escapeAttr(shape.label)}" points="${pts}" fill="${style.fill}" stroke="${style.border}" stroke-width="${VB * 0.002}" />`,
      );
    } else {
      const style = UNIT_STATUS_STYLES[shape.status ?? "available"];
      parts.push(
        `<polygon data-plot-id="${shape.localId}" data-plot-number="${escapeAttr(shape.label)}" points="${pts}" fill="${style.fill}" stroke="${style.border}" stroke-width="${VB * 0.002}" />`,
      );
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VB} ${VB}">${parts.join("")}</svg>`;
}

function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExportMenu({ shapes, projectName }: { shapes: DetectedShape[]; projectName: string }) {
  function exportJson() {
    downloadBlob(
      `${projectName}-digitized.json`,
      JSON.stringify(
        {
          projectName,
          plots: shapes.filter((s) => s.kind === "plot"),
          roads: shapes.filter((s) => s.kind === "road"),
          areas: shapes.filter((s) => s.kind === "feature"),
        },
        null,
        2,
      ),
      "application/json",
    );
  }

  function exportSvg() {
    downloadBlob(`${projectName}-digitized.svg`, buildSvgMarkup(shapes), "image/svg+xml");
  }

  async function exportPng() {
    const svgUrl = URL.createObjectURL(new Blob([buildSvgMarkup(shapes)], { type: "image/svg+xml" }));
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Could not rasterize the SVG for PNG export."));
        image.src = svgUrl;
      });
      const canvas = document.createElement("canvas");
      canvas.width = VB;
      canvas.height = VB;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#0b1f2e";
      ctx.fillRect(0, 0, VB, VB);
      ctx.drawImage(img, 0, 0, VB, VB);
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = `${projectName}-digitized.png`;
      a.click();
    } finally {
      URL.revokeObjectURL(svgUrl);
    }
  }

  const buttonClass = "rounded-md bg-gray-100 px-3 py-1.5 text-sm font-medium hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700";

  return (
    <div className="flex gap-2">
      <button type="button" onClick={exportJson} className={buttonClass}>
        Export JSON
      </button>
      <button type="button" onClick={exportSvg} className={buttonClass}>
        Export SVG
      </button>
      <button type="button" onClick={exportPng} className={buttonClass}>
        Export PNG
      </button>
    </div>
  );
}
