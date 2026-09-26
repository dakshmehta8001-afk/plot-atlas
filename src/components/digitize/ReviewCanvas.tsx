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
import { MAP_VIEWBOX_SIZE, type MapCalibration, type PolygonPoint } from "@/lib/types";
import { toSvgPoints, boundingBoxCenter, pointInPolygon, splitPolygonWithLine } from "@/lib/svgPolygon";
import type { DetectedShape } from "@/lib/digitize/types";
import { ShapeLayer } from "./ShapeLayer";
import { clientPointToLocalFraction } from "@/lib/svgCoords";
import type { ToolMode } from "./Toolbar";

const VB = MAP_VIEWBOX_SIZE;
type DrawMode = "draw-plot" | "draw-road" | "draw-area";
const MIN_DRAW_POINTS: Record<DrawMode, number> = {
  "draw-plot": 3,
  "draw-road": 2,
  "draw-area": 3,
};
const DRAW_MODE_LABEL: Record<DrawMode, string> = { "draw-plot": "plot", "draw-road": "road", "draw-area": "area" };

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
  /** Lets the "Resume drawing" banner switch back to whichever draw tool a parked draft belongs to. */
  onModeChange: (mode: ToolMode) => void;
  showOriginal: boolean;
  originalOpacity: number;
  /** The project's current scale reference, if any — drawn as a persistent
   * reference line so the reviewer can see calibration is already done and
   * where, same as any other confirmed shape stays visible on the canvas. */
  calibration?: MapCalibration | null;
  /** Called once both calibration points are placed AND a real-world
   * distance has been entered (the distance prompt lives inside this
   * component, not the parent — see the set-scale banner below). */
  onSetScale?: (pointA: PolygonPoint, pointB: PolygonPoint, realDistanceFt: number) => void;
  /** Called immediately on the second click of the set-north gesture (tail then tip of the plan's own printed north arrow) — no extra prompt needed, just the two points. */
  onSetNorth?: (pointA: PolygonPoint, pointB: PolygonPoint) => void;
}>(function ReviewCanvas(
  {
    sourceCanvas,
    shapes,
    selectedId,
    onSelect,
    mode,
    onUpdateShape,
    onAddShape,
    onSplitShape,
    onModeChange,
    showOriginal,
    originalOpacity,
    calibration,
    onSetScale,
    onSetNorth,
  },
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
  // Coordinate lookups (click-to-fraction, wheel-zoom-toward-cursor) go
  // through THIS element — the pan/zoom-transformed inner <g>, not the
  // outer <svg> (found from a real user report: "draw/split work at Fit,
  // not once I zoom in"). The outer <svg> sits ABOVE the pan/zoom
  // transform applied to this inner <g>; its own getScreenCTM() never
  // reflects that transform, so at Fit (pan/zoom = identity) the two
  // happen to agree, but the moment the reviewer zooms or pans they
  // diverge and clicks land in the wrong place. ShapeLayer/VertexHandle
  // never had this bug — they compute coordinates off a shape/vertex
  // element that's already INSIDE this group, so getScreenCTM() on those
  // always picks up the full transform chain correctly.
  const contentGroupRef = useRef<SVGGElement>(null);
  const [view, setView] = useState({ tx: 0, ty: 0, scale: 1 });
  const [drawPoints, setDrawPoints] = useState<PolygonPoint[]>([]);
  const [cursorPos, setCursorPos] = useState<PolygonPoint | null>(null);
  const [cutPoints, setCutPoints] = useState<PolygonPoint[]>([]);
  const [splitHoverId, setSplitHoverId] = useState<string | null>(null);
  const [splitError, setSplitError] = useState<string | null>(null);
  // Two more independent 2-click line gestures, deliberately kept as their
  // own separate state rather than generalizing cutPoints/splitError to
  // cover all three — the split tool already has real documented history
  // (a getScreenCTM coordinate bug, an accidental-discard bug) and this
  // avoids touching its working, already-debugged state entirely.
  const [scalePoints, setScalePoints] = useState<PolygonPoint[]>([]);
  const [scaleDistanceDraft, setScaleDistanceDraft] = useState("");
  const [northPoints, setNorthPoints] = useState<PolygonPoint[]>([]);
  // A draw tool's in-progress points, parked here when the reviewer
  // switches to a DIFFERENT tool before finishing — see the mode-change
  // effect below for why this exists and isn't just cleared outright.
  const [pendingDraft, setPendingDraft] = useState<{ mode: DrawMode; points: PolygonPoint[] } | null>(null);
  const isDrawMode = mode === "draw-plot" || mode === "draw-road" || mode === "draw-area";
  const isSplitMode = mode === "split-plot";
  const isScaleMode = mode === "set-scale";
  const isNorthMode = mode === "set-north";
  const isLineGestureMode = isSplitMode || isScaleMode || isNorthMode;
  const prevModeRef = useRef(mode);

  // Switching tools used to unconditionally clear `drawPoints` — the fix
  // for an earlier real bug (a reviewer stuck with 24 stray misplaced
  // points and no way to cancel them). But a real user then lost a
  // deliberately-traced 15-point shape the SAME way, just by clicking a
  // different toolbar button mid-trace — unconditionally discarding
  // everything conflated "a couple of accidental stray clicks" with "real,
  // effortful work," which are not the same thing and shouldn't be treated
  // the same way.
  //
  // Now: leaving a draw mode with 0-1 points (almost certainly accidental)
  // still discards silently, same as before. Leaving one with 2+ points
  // (real, deliberate tracing) instead PARKS it as `pendingDraft`, tied to
  // the specific draw tool it belongs to — switching back to that same
  // tool resumes it automatically, and the banner below (visible in any
  // mode) offers an explicit Resume or Discard rather than either losing
  // it silently or having it silently reappear unannounced.
  useEffect(() => {
    const prevMode = prevModeRef.current;
    prevModeRef.current = mode;
    const prevWasDraw = prevMode === "draw-plot" || prevMode === "draw-road" || prevMode === "draw-area";

    if (prevWasDraw && prevMode !== mode) {
      if (drawPoints.length >= 2) {
        setPendingDraft({ mode: prevMode as DrawMode, points: drawPoints });
      }
      setDrawPoints([]);
      setCursorPos(null);
    }

    if ((mode === "draw-plot" || mode === "draw-road" || mode === "draw-area") && pendingDraft?.mode === mode) {
      setDrawPoints(pendingDraft.points);
      setPendingDraft(null);
    }

    setCutPoints([]);
    setSplitHoverId(null);
    setSplitError(null);
    setScalePoints([]);
    setScaleDistanceDraft("");
    setNorthPoints([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately keyed only on `mode`; drawPoints/pendingDraft are read at their current value on each mode change, not tracked as triggers themselves
  }, [mode]);

  useEffect(() => {
    if (!isDrawMode && !isLineGestureMode) return;
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
        setScalePoints([]);
        setScaleDistanceDraft("");
        setNorthPoints([]);
      } else if (e.key === "Backspace" || e.key === "z") {
        setDrawPoints((prev) => prev.slice(0, -1));
        // A completed split/scale/north already goes through the same
        // shapesState history the Toolbar's Undo button uses (or, for
        // scale/north, the project-level calibration action) — this only
        // needs to cancel a PENDING (not-yet-completed) gesture's first
        // click, same as Escape does, since there's no "half-committed"
        // state beyond that single placed point for any of the three.
        setCutPoints((prev) => prev.slice(0, -1));
        setScalePoints((prev) => prev.slice(0, -1));
        setNorthPoints((prev) => prev.slice(0, -1));
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDrawMode, isLineGestureMode]);

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
    const group = contentGroupRef.current;
    if (!group) return;
    const local = clientPointToLocalFraction(group, e.clientX, e.clientY, VB);
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
    if (isDrawMode || isLineGestureMode) return;
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
    if (!contentGroupRef.current) return;

    if (isDrawMode) {
      const local = clientPointToLocalFraction(contentGroupRef.current, e.clientX, e.clientY, VB);
      if (local) setDrawPoints((prev) => [...prev, local]);
      return;
    }

    if (isSplitMode) {
      const local = clientPointToLocalFraction(contentGroupRef.current, e.clientX, e.clientY, VB);
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
      return;
    }

    if (isScaleMode) {
      const local = clientPointToLocalFraction(contentGroupRef.current, e.clientX, e.clientY, VB);
      if (!local) return;
      if (scalePoints.length === 0) {
        setScalePoints([local]);
        return;
      }
      // Second click just completes the LINE — the real-world distance is
      // entered afterward via the inline input in the banner below, and
      // onSetScale (which needs that number too) only fires once that's
      // confirmed, not on this click.
      setScalePoints([scalePoints[0], local]);
      return;
    }

    if (isNorthMode) {
      const local = clientPointToLocalFraction(contentGroupRef.current, e.clientX, e.clientY, VB);
      if (!local) return;
      if (northPoints.length === 0) {
        setNorthPoints([local]);
        return;
      }
      // North needs no extra numeric input (only the two points'
      // direction matters), so the second click can call straight up to
      // the parent and reset immediately, unlike scale above.
      onSetNorth?.(northPoints[0], local);
      setNorthPoints([]);
    }
  }

  // Rubber-band preview: tracks the cursor while drawing/cutting so the
  // in-progress edge is visible before it's actually placed, rather than
  // only ever seeing the shape/cut jump between committed points. Harmless
  // to fire on every mouse move (each is a discrete browser event, not a
  // render-triggered loop) — guarded to do nothing outside draw/split
  // modes, or before there's a first point to draw a line FROM.
  function handleCanvasMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!contentGroupRef.current) return;
    if (isDrawMode && drawPoints.length > 0) {
      const local = clientPointToLocalFraction(contentGroupRef.current, e.clientX, e.clientY, VB);
      if (local) setCursorPos(local);
      return;
    }
    if (isSplitMode) {
      const local = clientPointToLocalFraction(contentGroupRef.current, e.clientX, e.clientY, VB);
      if (!local) return;
      if (cutPoints.length > 0) setCursorPos(local);
      const hovered = shapes.find((s) => s.kind !== "road" && s.points.length >= 3 && pointInPolygon(local, s.points));
      setSplitHoverId(hovered ? hovered.localId : null);
      return;
    }
    if (isScaleMode && scalePoints.length === 1) {
      const local = clientPointToLocalFraction(contentGroupRef.current, e.clientX, e.clientY, VB);
      if (local) setCursorPos(local);
      return;
    }
    if (isNorthMode && northPoints.length === 1) {
      const local = clientPointToLocalFraction(contentGroupRef.current, e.clientX, e.clientY, VB);
      if (local) setCursorPos(local);
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
        viewBox={`0 0 ${VB} ${VB}`}
        preserveAspectRatio="none"
        className="h-full w-full"
        style={{ aspectRatio, cursor: isDrawMode || isLineGestureMode ? "crosshair" : "grab", touchAction: "none" }}
        onWheel={handleWheel}
        onPointerDown={handleBackgroundPointerDown}
        onPointerMove={handleBackgroundPointerMove}
        onPointerUp={handleBackgroundPointerUp}
        onMouseMove={handleCanvasMouseMove}
        onClick={handleCanvasClick}
        onDoubleClick={finishDrawing}
      >
        <g
          ref={contentGroupRef}
          style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`, transformOrigin: "0 0" }}
        >
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

          {/* The project's already-confirmed scale reference, drawn as a
              plain persistent line (not tied to any mode) so it's always
              visible as a reminder of what it was calibrated against —
              same idea as a confirmed shape staying visible after it's
              deselected. */}
          {calibration && (
            <g className="pointer-events-none">
              <line
                x1={calibration.pointA.x * VB}
                y1={calibration.pointA.y * VB}
                x2={calibration.pointB.x * VB}
                y2={calibration.pointB.y * VB}
                stroke="#22c55e"
                strokeWidth={VB * 0.002}
              />
              <circle cx={calibration.pointA.x * VB} cy={calibration.pointA.y * VB} r={VB * 0.005} fill="#22c55e" />
              <circle cx={calibration.pointB.x * VB} cy={calibration.pointB.y * VB} r={VB * 0.005} fill="#22c55e" />
              <text
                x={((calibration.pointA.x + calibration.pointB.x) / 2) * VB}
                y={((calibration.pointA.y + calibration.pointB.y) / 2) * VB - VB * 0.012}
                textAnchor="middle"
                fontSize={VB * 0.013}
                fill="#22c55e"
                className="select-none font-medium"
                style={{ paintOrder: "stroke", stroke: "#0b1f2e", strokeWidth: VB * 0.003 }}
              >
                Scale: {calibration.realDistanceFt}&apos;
              </text>
            </g>
          )}

          {(isScaleMode || isNorthMode) && (
            <g className="pointer-events-none">
              {(isScaleMode ? scalePoints : northPoints).map((p, i) => (
                <circle key={i} cx={p.x * VB} cy={p.y * VB} r={VB * 0.007} fill={isScaleMode ? "#22c55e" : "#a855f7"} />
              ))}
              {(isScaleMode ? scalePoints : northPoints).length === 1 && cursorPos && (
                <line
                  x1={(isScaleMode ? scalePoints : northPoints)[0].x * VB}
                  y1={(isScaleMode ? scalePoints : northPoints)[0].y * VB}
                  x2={cursorPos.x * VB}
                  y2={cursorPos.y * VB}
                  stroke={isScaleMode ? "#22c55e" : "#a855f7"}
                  strokeWidth={VB * 0.0025}
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

      {pendingDraft && !(isDrawMode && drawPoints.length > 0) && (
        <div className="absolute left-3 top-3 flex items-center gap-2 rounded-md bg-amber-600/90 px-3 py-1.5 text-xs text-white">
          <span>
            Unfinished {DRAW_MODE_LABEL[pendingDraft.mode]} draft ({pendingDraft.points.length} points)
          </span>
          <button
            type="button"
            onClick={() => onModeChange(pendingDraft.mode)}
            className="rounded bg-white/20 px-2 py-0.5 font-medium hover:bg-white/30"
          >
            Resume
          </button>
          <button
            type="button"
            onClick={() => setPendingDraft(null)}
            className="rounded bg-red-500/80 px-2 py-0.5 font-medium hover:bg-red-500"
          >
            Discard
          </button>
        </div>
      )}

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

      {isScaleMode && (
        <div className="absolute left-3 top-3 flex items-center gap-2 rounded-md bg-black/60 px-3 py-1.5 text-xs text-white">
          {scalePoints.length < 2 ? (
            <span>
              {scalePoints.length === 0
                ? "Click one end of something with a known real-world length (e.g. a labeled road's width), then the other end."
                : "Click the second point."}
            </span>
          ) : (
            <>
              <span>Real-world distance between those two points:</span>
              <input
                type="number"
                min={0}
                step="any"
                autoFocus
                value={scaleDistanceDraft}
                onChange={(e) => setScaleDistanceDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  const feet = Number(scaleDistanceDraft);
                  if (!Number.isFinite(feet) || feet <= 0) return;
                  onSetScale?.(scalePoints[0], scalePoints[1], feet);
                  setScalePoints([]);
                  setScaleDistanceDraft("");
                }}
                placeholder="feet"
                className="w-16 rounded bg-white/90 px-1.5 py-0.5 text-[#0f2436]"
              />
              <span>ft</span>
              <button
                type="button"
                onClick={() => {
                  const feet = Number(scaleDistanceDraft);
                  if (!Number.isFinite(feet) || feet <= 0) return;
                  onSetScale?.(scalePoints[0], scalePoints[1], feet);
                  setScalePoints([]);
                  setScaleDistanceDraft("");
                }}
                disabled={!Number.isFinite(Number(scaleDistanceDraft)) || Number(scaleDistanceDraft) <= 0}
                className="rounded bg-green-500/80 px-2 py-0.5 font-medium hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Confirm
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => {
              setScalePoints([]);
              setScaleDistanceDraft("");
            }}
            className="rounded bg-red-500/80 px-2 py-0.5 font-medium hover:bg-red-500"
          >
            Cancel
          </button>
        </div>
      )}

      {isNorthMode && (
        <div className="absolute left-3 top-3 flex items-center gap-2 rounded-md bg-black/60 px-3 py-1.5 text-xs text-white">
          <span>
            {northPoints.length === 0
              ? "Click the tail of the plan's own printed north arrow, then its tip."
              : "Click the arrow's tip."}
          </span>
          {northPoints.length > 0 && (
            <button type="button" onClick={() => setNorthPoints([])} className="rounded bg-red-500/80 px-2 py-0.5 font-medium hover:bg-red-500">
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
});
