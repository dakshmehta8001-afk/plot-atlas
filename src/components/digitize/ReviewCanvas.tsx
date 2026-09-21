"use client";

// The digitize feature's own SVG canvas — same viewBox="0 0 1000 1000" +
// fractional-point convention as PolygonTracer/SitePlanViewer (see
// src/lib/types.ts's PolygonPoint doc comment), but layered with what
// neither of those needs: free pan/zoom (via a CSS transform on an inner
// <g>, wheel-to-zoom-toward-cursor + pointer-drag-to-pan), an original-image
// opacity toggle so the reviewer can compare against the source photo while
// correcting a boundary, and draw-a-new-shape support for draw-plot/draw-
// road/draw-area tool modes.
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { MAP_VIEWBOX_SIZE, type PolygonPoint } from "@/lib/types";
import { toSvgPoints, boundingBoxCenter } from "@/lib/svgPolygon";
import type { DetectedShape } from "@/lib/digitize/types";
import { ShapeLayer } from "./ShapeLayer";
import { clientPointToLocalFraction } from "./svgCoords";
import type { ToolMode } from "./Toolbar";

const VB = MAP_VIEWBOX_SIZE;
const MIN_DRAW_POINTS: Record<"draw-plot" | "draw-road" | "draw-area", number> = {
  "draw-plot": 3,
  "draw-road": 2,
  "draw-area": 3,
};

export interface ReviewCanvasHandle {
  /** Pans/zooms so the given shape's bounding-box center is centered on screen — used by SearchPlotNumber to satisfy "search → zoom to it → highlight it." */
  focusOnPoints: (points: PolygonPoint[]) => void;
}

export const ReviewCanvas = forwardRef<ReviewCanvasHandle, {
  sourceCanvas: HTMLCanvasElement;
  shapes: DetectedShape[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  mode: ToolMode;
  onUpdateShape: (id: string, points: PolygonPoint[]) => void;
  onAddShape: (kind: "plot" | "road" | "feature", points: PolygonPoint[]) => void;
  showOriginal: boolean;
  originalOpacity: number;
}>(function ReviewCanvas(
  { sourceCanvas, shapes, selectedId, onSelect, mode, onUpdateShape, onAddShape, showOriginal, originalOpacity },
  ref,
) {
  const aspectRatio = sourceCanvas.width / sourceCanvas.height;
  // toDataURL runs once per detection result (sourceCanvas identity is
  // stable across re-renders of this component within one review session),
  // not on every render — an SVG <image> needs a URL, and this is the same
  // approach the rest of the app uses for uploaded plan images, just backed
  // by an in-memory canvas instead of a stored file.
  const imageHref = useMemo(() => sourceCanvas.toDataURL("image/png"), [sourceCanvas]);

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState({ tx: 0, ty: 0, scale: 1 });
  const [drawPoints, setDrawPoints] = useState<PolygonPoint[]>([]);
  const isDrawMode = mode === "draw-plot" || mode === "draw-road" || mode === "draw-area";

  // There was no way to back out of a draw once started — a misclick had no
  // recovery besides finishing a shape you didn't want (found from a real
  // user getting stuck mid-drawing with 24 stray points and no way to clear
  // them). Switching tools now implicitly cancels any in-progress draw
  // (this effect), Escape cancels it explicitly without switching tools,
  // and a visible "Cancel" button (below) covers reviewers who don't know
  // the Escape shortcut. Previously, switching tools only stopped the
  // preview from RENDERING (isDrawMode became false) without actually
  // clearing `drawPoints` — the stray points would silently reappear if
  // the reviewer picked the same draw tool again later.
  useEffect(() => {
    setDrawPoints([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately keyed only on `mode`, not on drawPoints itself
  }, [mode]);

  useEffect(() => {
    if (!isDrawMode) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setDrawPoints([]);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDrawMode]);

  useImperativeHandle(ref, () => ({
    focusOnPoints(points: PolygonPoint[]) {
      if (points.length === 0) return;
      const center = boundingBoxCenter(points);
      const target = VB / 2;
      const focusScale = 4;
      setView({ tx: target - focusScale * center.x, ty: target - focusScale * center.y, scale: focusScale });
    },
  }));

  function handleWheel(e: React.WheelEvent<SVGSVGElement>) {
    e.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;
    const local = clientPointToLocalFraction(svg, e.clientX, e.clientY, VB);
    if (!local) return;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setView((prev) => {
      const nextScale = Math.min(12, Math.max(1, prev.scale * factor));
      // Keep the point under the cursor fixed on screen while zooming: solve
      // for the new translate so local*VB maps to the same screen position
      // before and after the scale change (same algebra SitePlanViewer uses
      // for its zoom-to-shape animation, just driven by cursor position
      // instead of a clicked shape's center).
      const px = local.x * VB;
      const py = local.y * VB;
      const tx = px - ((px - prev.tx) / prev.scale) * nextScale;
      const ty = py - ((py - prev.ty) / prev.scale) * nextScale;
      return { tx, ty, scale: nextScale };
    });
  }

  const panState = useRef<{ startX: number; startY: number; origTx: number; origTy: number } | null>(null);

  function handleBackgroundPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (isDrawMode) return;
    if (mode === "select") onSelect(null);
    panState.current = { startX: e.clientX, startY: e.clientY, origTx: view.tx, origTy: view.ty };
    (e.target as Element).setPointerCapture(e.pointerId);
  }
  function handleBackgroundPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!panState.current) return;
    const dx = e.clientX - panState.current.startX;
    const dy = e.clientY - panState.current.startY;
    setView((prev) => ({ ...prev, tx: panState.current!.origTx + dx, ty: panState.current!.origTy + dy }));
  }
  function handleBackgroundPointerUp() {
    panState.current = null;
  }

  function handleCanvasClick(e: React.MouseEvent<SVGSVGElement>) {
    if (!isDrawMode || !svgRef.current) return;
    const local = clientPointToLocalFraction(svgRef.current, e.clientX, e.clientY, VB);
    if (local) setDrawPoints((prev) => [...prev, local]);
  }

  function finishDrawing() {
    if (!isDrawMode) return;
    const min = MIN_DRAW_POINTS[mode as "draw-plot" | "draw-road" | "draw-area"];
    if (drawPoints.length < min) return;
    const kind = mode === "draw-plot" ? "plot" : mode === "draw-road" ? "road" : "feature";
    onAddShape(kind, drawPoints);
    setDrawPoints([]);
  }

  function resetView() {
    setView({ tx: 0, ty: 0, scale: 1 });
  }
  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      containerRef.current?.requestFullscreen().catch(() => {
        // Fullscreen can be denied by the browser (e.g. not user-initiated
        // enough, or unsupported) — not worth surfacing as an error, the
        // reviewer just keeps the normal-size canvas.
      });
    }
  }
  function zoomBy(factor: number) {
    setView((prev) => {
      const nextScale = Math.min(12, Math.max(1, prev.scale * factor));
      const center = VB / 2;
      const tx = center - ((center - prev.tx) / prev.scale) * nextScale;
      const ty = center - ((center - prev.ty) / prev.scale) * nextScale;
      return { tx, ty, scale: nextScale };
    });
  }

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden rounded-lg border border-gray-200 bg-[#0b1f2e] dark:border-gray-800">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VB} ${VB}`}
        preserveAspectRatio="none"
        className="h-full w-full"
        style={{ aspectRatio, cursor: isDrawMode ? "crosshair" : "grab", touchAction: "none" }}
        onWheel={handleWheel}
        onPointerDown={handleBackgroundPointerDown}
        onPointerMove={handleBackgroundPointerMove}
        onPointerUp={handleBackgroundPointerUp}
        onClick={handleCanvasClick}
        onDoubleClick={finishDrawing}
      >
        <g style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`, transformOrigin: "0 0" }}>
          {showOriginal && (
            <image href={imageHref} x={0} y={0} width={VB} height={VB} preserveAspectRatio="none" opacity={originalOpacity} />
          )}

          <ShapeLayer shapes={shapes} selectedId={selectedId} onSelect={onSelect} mode={mode} onUpdateShape={onUpdateShape} />

          {isDrawMode && drawPoints.length > 0 && (
            <g className="pointer-events-none">
              {mode === "draw-road" ? (
                <polyline points={toSvgPoints(drawPoints)} fill="none" stroke="#3b82f6" strokeWidth={VB * 0.003} />
              ) : (
                <polygon points={toSvgPoints(drawPoints)} fill="rgba(59,130,246,0.25)" stroke="#3b82f6" strokeWidth={VB * 0.003} />
              )}
              {drawPoints.map((p, i) => (
                <circle key={i} cx={p.x * VB} cy={p.y * VB} r={VB * 0.006} fill="#3b82f6" />
              ))}
            </g>
          )}
        </g>
      </svg>

      <div className="absolute bottom-3 right-3 flex flex-col gap-1.5">
        <button type="button" onClick={() => zoomBy(1.3)} className="h-8 w-8 rounded-md bg-white/90 text-lg font-semibold text-[#0f2436] shadow hover:bg-white">
          +
        </button>
        <button type="button" onClick={() => zoomBy(1 / 1.3)} className="h-8 w-8 rounded-md bg-white/90 text-lg font-semibold text-[#0f2436] shadow hover:bg-white">
          −
        </button>
        <button type="button" onClick={resetView} className="rounded-md bg-white/90 px-2 py-1 text-xs font-medium text-[#0f2436] shadow hover:bg-white">
          Fit
        </button>
        <button type="button" onClick={toggleFullscreen} className="rounded-md bg-white/90 px-2 py-1 text-xs font-medium text-[#0f2436] shadow hover:bg-white">
          ⛶
        </button>
      </div>

      {isDrawMode && drawPoints.length > 0 && (
        <div className="absolute left-3 top-3 flex items-center gap-2 rounded-md bg-black/60 px-3 py-1.5 text-xs text-white">
          <span>{drawPoints.length} point(s) — double-click to finish</span>
          <button
            type="button"
            onClick={() => setDrawPoints((prev) => prev.slice(0, -1))}
            className="rounded bg-white/20 px-2 py-0.5 font-medium hover:bg-white/30"
          >
            Undo point
          </button>
          <button
            type="button"
            onClick={() => setDrawPoints([])}
            className="rounded bg-red-500/80 px-2 py-0.5 font-medium hover:bg-red-500"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
});
