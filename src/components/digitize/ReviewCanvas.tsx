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
import { toSvgPoints, boundingBoxCenter, pointInPolygon, splitPolygonWithLine } from "@/lib/svgPolygon";
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
  /** Replaces one shape with two, the result of the Split tool cutting it along a line. */
  onSplitShape: (id: string, parts: [PolygonPoint[], PolygonPoint[]]) => void;
  showOriginal: boolean;
  originalOpacity: number;
}>(function ReviewCanvas(
  { sourceCanvas, shapes, selectedId, onSelect, mode, onUpdateShape, onAddShape, onSplitShape, showOriginal, originalOpacity },
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
  const [cursorPos, setCursorPos] = useState<PolygonPoint | null>(null);
  const [cutPoints, setCutPoints] = useState<PolygonPoint[]>([]);
  const [splitHoverId, setSplitHoverId] = useState<string | null>(null);
  const [splitError, setSplitError] = useState<string | null>(null);
  const isDrawMode = mode === "draw-plot" || mode === "draw-road" || mode === "draw-area";
  const isSplitMode = mode === "split-plot";

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
    setCursorPos(null);
    setCutPoints([]);
    setSplitHoverId(null);
    setSplitError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately keyed only on `mode`, not on drawPoints/cutPoints themselves
  }, [mode]);

  useEffect(() => {
    if (!isDrawMode && !isSplitMode) return;
    function handleKeyDown(e: KeyboardEvent) {
      // Ignore when the reviewer is typing into an input/textarea elsewhere
      // on the page (e.g. the search box, a shape's label field) — "z" in
      // particular is a normal character to type, not just an undo chord.
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;

      if (e.key === "Escape") {
        setDrawPoints([]);
        setCutPoints([]);
        setSplitError(null);
      } else if (e.key === "Backspace" || e.key === "z") {
        setDrawPoints((prev) => prev.slice(0, -1));
        // A completed split already goes through the same shapesState
        // history the Toolbar's Undo button uses — this only needs to
        // cancel a PENDING (not-yet-completed) cut's first click, same as
        // Escape does, since there's no "half-committed" split state
        // beyond that single placed point.
        setCutPoints((prev) => prev.slice(0, -1));
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDrawMode, isSplitMode]);

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
    if (isDrawMode || isSplitMode) return;
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

  // Finds which existing plot/feature the cut line actually splits cleanly
  // — roads are excluded (open polylines, nothing to "split" the same way)
  // and whichever shape is currently hover-highlighted is tried first,
  // since that's the one the reviewer was visually aiming at; any other
  // shape the line happens to also cross cleanly is a fallback, not the
  // primary target.
  function findSplitTarget(a: PolygonPoint, b: PolygonPoint): { id: string; parts: [PolygonPoint[], PolygonPoint[]] } | null {
    const candidates = shapes.filter((s) => s.kind !== "road" && s.points.length >= 3);
    if (splitHoverId) {
      const idx = candidates.findIndex((s) => s.localId === splitHoverId);
      if (idx > 0) candidates.unshift(candidates.splice(idx, 1)[0]);
    }
    for (const shape of candidates) {
      const parts = splitPolygonWithLine(shape.points, a, b);
      if (parts) return { id: shape.localId, parts };
    }
    return null;
  }

  function handleCanvasClick(e: React.MouseEvent<SVGSVGElement>) {
    if (!svgRef.current) return;

    if (isDrawMode) {
      const local = clientPointToLocalFraction(svgRef.current, e.clientX, e.clientY, VB);
      if (local) setDrawPoints((prev) => [...prev, local]);
      return;
    }

    if (isSplitMode) {
      const local = clientPointToLocalFraction(svgRef.current, e.clientX, e.clientY, VB);
      if (!local) return;
      if (cutPoints.length === 0) {
        setSplitError(null);
        setCutPoints([local]);
        return;
      }
      // Second click completes the cut attempt either way — a failed cut
      // (the line doesn't cleanly split any shape) is communicated via
      // `splitError`, not by leaving the reviewer stuck mid-cut with no
      // way to tell what happened.
      const target = findSplitTarget(cutPoints[0], local);
      if (target) {
        onSplitShape(target.id, target.parts);
        setSplitError(null);
      } else {
        setSplitError("That line didn't cleanly cross a single plot — try a straighter cut fully through one shape.");
      }
      setCutPoints([]);
      setSplitHoverId(null);
    }
  }

  // Rubber-band preview: tracks the cursor while drawing/cutting so the
  // in-progress edge is visible before it's actually placed, rather than
  // only ever seeing the shape/cut jump between committed points. Harmless
  // to fire on every mouse move (each is a discrete browser event, not a
  // render-triggered loop) — guarded to do nothing outside draw/split
  // modes, or before there's a first point to draw a line FROM.
  function handleCanvasMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!svgRef.current) return;
    if (isDrawMode && drawPoints.length > 0) {
      const local = clientPointToLocalFraction(svgRef.current, e.clientX, e.clientY, VB);
      if (local) setCursorPos(local);
      return;
    }
    if (isSplitMode) {
      const local = clientPointToLocalFraction(svgRef.current, e.clientX, e.clientY, VB);
      if (!local) return;
      if (cutPoints.length > 0) setCursorPos(local);
      const hovered = shapes.find((s) => s.kind !== "road" && s.points.length >= 3 && pointInPolygon(local, s.points));
      setSplitHoverId(hovered ? hovered.localId : null);
    }
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
        style={{ aspectRatio, cursor: isDrawMode || isSplitMode ? "crosshair" : "grab", touchAction: "none" }}
        onWheel={handleWheel}
        onPointerDown={handleBackgroundPointerDown}
        onPointerMove={handleBackgroundPointerMove}
        onPointerUp={handleBackgroundPointerUp}
        onMouseMove={handleCanvasMouseMove}
        onClick={handleCanvasClick}
        onDoubleClick={finishDrawing}
      >
        <g style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`, transformOrigin: "0 0" }}>
          {showOriginal && (
            <image href={imageHref} x={0} y={0} width={VB} height={VB} preserveAspectRatio="none" opacity={originalOpacity} />
          )}

          <ShapeLayer
            shapes={shapes}
            selectedId={selectedId}
            onSelect={onSelect}
            mode={mode}
            onUpdateShape={onUpdateShape}
            splitHoverId={isSplitMode ? splitHoverId : null}
          />

          {isSplitMode && (
            <g className="pointer-events-none">
              {cutPoints.map((p, i) => (
                <circle key={i} cx={p.x * VB} cy={p.y * VB} r={VB * 0.007} fill="#f97316" />
              ))}
              {cutPoints.length > 0 && cursorPos && (
                <line
                  x1={cutPoints[0].x * VB}
                  y1={cutPoints[0].y * VB}
                  x2={cursorPos.x * VB}
                  y2={cursorPos.y * VB}
                  stroke="#f97316"
                  strokeWidth={VB * 0.0025}
                  strokeDasharray={`${VB * 0.008} ${VB * 0.006}`}
                />
              )}
            </g>
          )}

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
              {cursorPos && (
                <line
                  x1={drawPoints[drawPoints.length - 1].x * VB}
                  y1={drawPoints[drawPoints.length - 1].y * VB}
                  x2={cursorPos.x * VB}
                  y2={cursorPos.y * VB}
                  stroke="#3b82f6"
                  strokeWidth={VB * 0.0018}
                  strokeDasharray={`${VB * 0.008} ${VB * 0.006}`}
                />
              )}
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

      {isSplitMode && (
        <div className="absolute left-3 top-3 flex items-center gap-2 rounded-md bg-black/60 px-3 py-1.5 text-xs text-white">
          <span>
            {cutPoints.length === 0
              ? "Click one point, then a second point on the far side of the plot to cut it in two."
              : "Click the second point to cut."}
          </span>
          {cutPoints.length > 0 && (
            <button
              type="button"
              onClick={() => setCutPoints([])}
              className="rounded bg-red-500/80 px-2 py-0.5 font-medium hover:bg-red-500"
            >
              Cancel
            </button>
          )}
        </div>
      )}
      {isSplitMode && splitError && (
        <p className="absolute left-3 top-12 max-w-sm rounded-md bg-red-500/90 px-3 py-1.5 text-xs text-white">{splitError}</p>
      )}
    </div>
  );
});
