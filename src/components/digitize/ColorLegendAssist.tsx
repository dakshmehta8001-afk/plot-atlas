"use client";

// A one-time assist for plans like Naman Infracity that print their own
// color-coded plot-schedule legend (e.g. orange = 30'x60', blue = 30'x55')
// — rather than trying to automatically OCR-read an arbitrary legend box's
// layout (the kind of unbounded computer-vision problem this whole feature
// has consistently avoided elsewhere, per the "detection is a rough draft,
// review is the real product" philosophy), this samples each detected
// plot's own real fill color from the source image, groups plots that
// share (approximately) the same color, and lets the reviewer type ONE
// category name per distinct color — reading it straight off the legend
// printed on the plan in front of them, which they can already see. This
// only ever sets `category` (the existing free-text zone tag), never
// `dimensions` — exact size comes solely from calibrated geometry (see
// src/lib/calibration.ts), so a wrong or skipped color match can never
// produce a wrong plot size.
import { useMemo, useState } from "react";
import type { DetectedShape } from "@/lib/digitize/types";

interface ColorCluster {
  color: string; // "rgb(r,g,b)", also used directly as the swatch's own background
  localIds: string[];
}

// Euclidean RGB distance — small enough to keep visually-distinct legend
// colors separate, large enough to absorb ordinary anti-aliasing/
// compression noise between same-color plots. Raised from an initial 24
// after testing against a real JPEG-compressed site plan (not a clean
// synthetic one): JPEG's lossy compression alone introduces enough
// per-block color drift between individual same-color plot swatches that
// 24 split one real ~5-color legend into 11 spurious clusters; 55 brought
// that down to 7 on the same image — better, though not a perfect match
// to the legend's actual color count. Sequential single-linkage
// clustering (each color joins the first existing cluster within range,
// rather than comparing against a running average) means a chain of
// slightly-drifting samples can still end up split across two clusters;
// a genuinely robust fix would need real color quantization, not just a
// bigger threshold. Acceptable for what this is — an optional one-time
// assist a reviewer can freely re-apply, correct, or skip entirely, not a
// silent source of truth for anything persisted.
const CLUSTER_DISTANCE = 55;

function sampleColor(sourceCanvas: HTMLCanvasElement, shape: DetectedShape): [number, number, number] | null {
  if (shape.points.length < 3) return null;
  const xs = shape.points.map((p) => p.x);
  const ys = shape.points.map((p) => p.y);
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
  const px = Math.round(centerX * sourceCanvas.width);
  const py = Math.round(centerY * sourceCanvas.height);
  const ctx = sourceCanvas.getContext("2d");
  if (!ctx) return null;
  const inBounds = px >= 0 && py >= 0 && px < sourceCanvas.width && py < sourceCanvas.height;
  if (!inBounds) return null;
  const [r, g, b] = ctx.getImageData(px, py, 1, 1).data;
  return [r, g, b];
}

function colorDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export function ColorLegendAssist({
  shapes,
  sourceCanvas,
  onApplyCategory,
}: {
  shapes: DetectedShape[];
  sourceCanvas: HTMLCanvasElement;
  onApplyCategory: (localIds: string[], category: string) => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});

  // Recomputed only when the plot set itself changes (a shape added/
  // removed/split) — sampling ~100 single pixels is cheap, but there's no
  // reason to redo it on every unrelated keystroke elsewhere in the app.
  const clusters = useMemo<ColorCluster[]>(() => {
    const plots = shapes.filter((s) => s.kind === "plot" && !s.category);
    const rgbClusters: { rgb: [number, number, number]; localIds: string[] }[] = [];
    for (const plot of plots) {
      const rgb = sampleColor(sourceCanvas, plot);
      if (!rgb) continue;
      const existing = rgbClusters.find((c) => colorDistance(c.rgb, rgb) < CLUSTER_DISTANCE);
      if (existing) existing.localIds.push(plot.localId);
      else rgbClusters.push({ rgb, localIds: [plot.localId] });
    }
    return rgbClusters
      .filter((c) => c.localIds.length > 0)
      .sort((a, b) => b.localIds.length - a.localIds.length)
      .map((c) => ({ color: `rgb(${c.rgb[0]}, ${c.rgb[1]}, ${c.rgb[2]})`, localIds: c.localIds }));
  }, [shapes, sourceCanvas]);

  if (dismissed || clusters.length === 0) return null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium">
          Color-coded plots found — name each color once, read from the plan&apos;s own legend, to tag every matching plot&apos;s
          category in one go.
        </p>
        <button type="button" onClick={() => setDismissed(true)} className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
          Dismiss
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {clusters.map((cluster) => (
          <div key={cluster.color} className="flex items-center gap-1.5 rounded-md border border-gray-200 p-1.5 dark:border-gray-700">
            <span className="h-6 w-6 rounded border border-gray-300 dark:border-gray-600" style={{ backgroundColor: cluster.color }} />
            <span className="text-xs text-gray-400">{cluster.localIds.length}×</span>
            <input
              type="text"
              value={draftNames[cluster.color] ?? ""}
              onChange={(e) => setDraftNames((prev) => ({ ...prev, [cluster.color]: e.target.value }))}
              placeholder="Category name"
              className="w-32 rounded border border-gray-300 px-1.5 py-0.5 text-xs dark:border-gray-700 dark:bg-gray-950"
            />
            <button
              type="button"
              disabled={!draftNames[cluster.color]?.trim()}
              onClick={() => onApplyCategory(cluster.localIds, draftNames[cluster.color]!.trim())}
              className="rounded bg-gray-900 px-2 py-0.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-gray-900"
            >
              Apply
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
