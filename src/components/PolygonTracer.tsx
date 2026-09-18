"use client";

// Sub-admin's manual polygon-tracing tool, shared by every "trace a shape on
// an image" screen in the dashboard: plots and building footprints on a
// project's master site-plan image, and flats on a building floor's own
// plan image. The sub-admin clicks points directly on the image; each click
// is converted from screen pixels to a fraction (0..1) of the image's own
// width/height (via the SVG's bounding rect), so the resulting polygon
// renders identically regardless of what size the browser happens to
// display the image at. This is deliberately manual — there's no image
// recognition involved (see the plan-parsing discussion in project memory).
import { useRef, useState } from "react";
import { MAP_VIEWBOX_SIZE, type PolygonPoint } from "@/lib/types";
import { useImageAspectRatio } from "@/lib/useImageAspectRatio";
import { toSvgPoints } from "@/lib/svgPolygon";

const VB = MAP_VIEWBOX_SIZE;

// A single already-traced shape to render read-only underneath whatever the
// sub-admin is currently drawing — e.g. every existing plot/building while
// tracing a new one, so they can trace around what's already there. Most
// shapes are closed polygons (a plot/building/flat outline); a road is an
// open polyline traced along its centerline instead, so it renders as a
// line rather than a filled/closed area.
export interface TracerShape {
  id: string;
  points: PolygonPoint[];
  fill: string;
  stroke: string;
  label: string;
  kind?: "polygon" | "line";
}

// One "start tracing" option offered to the sub-admin — the master site
// plan offers three (plot, building, road), a floor's plan offers just one
// (flat). Keeping this as a list rather than a single onPolygonComplete
// callback is what lets one tracer instance/canvas serve all these cases
// without the caller juggling several separate <svg> elements over the
// same image. `shapeKind: "line"` traces an open road centerline (minimum
// 2 points, not closed) instead of a closed shape (minimum 3 points).
export interface TraceAction {
  label: string;
  shapeKind?: "polygon" | "line";
  onComplete: (points: PolygonPoint[]) => void;
}

export function PolygonTracer({
  planImageUrl,
  shapes,
  onSelectShape,
  traceActions,
}: {
  planImageUrl: string;
  shapes: TracerShape[];
  onSelectShape: (id: string) => void;
  traceActions: TraceAction[];
}) {
  const [activeActionIndex, setActiveActionIndex] = useState<number | null>(null);
  const [points, setPoints] = useState<PolygonPoint[]>([]);
  const svgRef = useRef<SVGSVGElement>(null);
  const aspectRatio = useImageAspectRatio(planImageUrl);
  const drawing = activeActionIndex !== null;
  const activeShapeKind = activeActionIndex !== null ? traceActions[activeActionIndex].shapeKind ?? "polygon" : "polygon";
  const minPoints = activeShapeKind === "line" ? 2 : 3;

  function handleSvgClick(event: React.MouseEvent<SVGSVGElement>) {
    if (!drawing || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    setPoints((prev) => [...prev, { x, y }]);
  }

  function startDrawing(actionIndex: number) {
    setActiveActionIndex(actionIndex);
    setPoints([]);
  }

  function undoPoint() {
    setPoints((prev) => prev.slice(0, -1));
  }

  function cancelDrawing() {
    setActiveActionIndex(null);
    setPoints([]);
  }

  function finishShape() {
    if (points.length < minPoints || activeActionIndex === null) return;
    traceActions[activeActionIndex].onComplete(points);
    setActiveActionIndex(null);
    setPoints([]);
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {!drawing ? (
          traceActions.map((action, i) => (
            <button
              key={action.label}
              type="button"
              onClick={() => startDrawing(i)}
              className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900"
            >
              {action.label}
            </button>
          ))
        ) : (
          <>
            <span className="text-sm text-gray-500">
              Click points on the image to trace the outline ({points.length} point
              {points.length === 1 ? "" : "s"} so far).
            </span>
            <button
              type="button"
              onClick={undoPoint}
              disabled={points.length === 0}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-gray-600"
            >
              Undo point
            </button>
            <button
              type="button"
              onClick={finishShape}
              disabled={points.length < minPoints}
              className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50"
            >
              Finish {activeShapeKind === "line" ? "road" : "shape"}
            </button>
            <button type="button" onClick={cancelDrawing} className="text-sm text-gray-500 hover:underline">
              Cancel
            </button>
          </>
        )}
      </div>

      <div
        className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800"
        style={{ aspectRatio }}
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VB} ${VB}`}
          preserveAspectRatio="none"
          onClick={handleSvgClick}
          className={`h-full w-full bg-gray-100 dark:bg-gray-900 ${drawing ? "cursor-crosshair" : ""}`}
        >
          <image href={planImageUrl} x={0} y={0} width={VB} height={VB} preserveAspectRatio="none" />

          {shapes.map((shape) => {
            const isLine = shape.kind === "line";
            if (shape.points.length < (isLine ? 2 : 3)) return null;
            const Tag = isLine ? "polyline" : "polygon";
            return (
              <Tag
                key={shape.id}
                points={toSvgPoints(shape.points)}
                fill={isLine ? "none" : shape.fill}
                stroke={shape.stroke}
                strokeWidth={isLine ? VB * 0.012 : VB * 0.002}
                strokeLinecap={isLine ? "round" : undefined}
                opacity={isLine ? 0.5 : 1}
                className={drawing ? "" : "cursor-pointer hover:opacity-80"}
                onClick={(e) => {
                  if (drawing) return;
                  e.stopPropagation();
                  onSelectShape(shape.id);
                }}
              >
                <title>{shape.label}</title>
              </Tag>
            );
          })}

          {points.length > 0 && (
            <>
              <polyline points={toSvgPoints(points)} fill="none" stroke="#2563eb" strokeWidth={VB * 0.003} />
              {points.map((p, i) => (
                <circle key={i} cx={p.x * VB} cy={p.y * VB} r={VB * 0.006} fill="#2563eb" />
              ))}
            </>
          )}
        </svg>
      </div>
    </div>
  );
}
