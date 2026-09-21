"use client";

// Renders every in-progress DetectedShape and, when the selected shape is in
// "edit-points" mode, its draggable vertex handles. Double-clicking a
// shape's own edge inserts a new point there; double-clicking a vertex
// removes it (ShapeDetailsPanel/Toolbar's Delete button removes the whole
// shape instead).
import { MAP_VIEWBOX_SIZE, SITE_FEATURE_STYLES, UNIT_STATUS_STYLES } from "@/lib/types";
import { boundingBoxCenter, deleteVertex, insertVertex, moveVertex, nearestEdgeInsertion, toSvgPoints } from "@/lib/svgPolygon";
import type { DetectedShape } from "@/lib/digitize/types";
import { VertexHandle } from "./VertexHandle";
import { clientPointToLocalFraction } from "./svgCoords";
import type { ToolMode } from "./Toolbar";

const VB = MAP_VIEWBOX_SIZE;
const MIN_POINTS: Record<DetectedShape["kind"], number> = { plot: 3, feature: 3, road: 2 };

function styleFor(shape: DetectedShape): { fill: string; stroke: string; dashed: boolean } {
  if (shape.kind === "road") return { fill: "none", stroke: "#f5c94b", dashed: false };
  if (shape.kind === "feature" && shape.featureKind) {
    const s = SITE_FEATURE_STYLES[shape.featureKind];
    return { fill: s.fill, stroke: s.border, dashed: false };
  }
  const s = UNIT_STATUS_STYLES[shape.status ?? "available"];
  // Low-confidence, still-automatic (never manually touched) shapes get a
  // dashed outline — a visual "please double-check this one" hint, never a
  // claim about how accurate the boundary actually is.
  const lowConfidence = shape.source === "detected" && (shape.confidence ?? 1) < 0.55;
  return { fill: s.fill, stroke: s.border, dashed: lowConfidence };
}

export function ShapeLayer({
  shapes,
  selectedId,
  onSelect,
  mode,
  onUpdateShape,
  splitHoverId,
}: {
  shapes: DetectedShape[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  mode: ToolMode;
  onUpdateShape: (id: string, points: DetectedShape["points"]) => void;
  /** The shape currently under the cursor in Split-plot mode — highlighted as the "you're about to cut this one" target. Not a selection; unrelated to selectedId. */
  splitHoverId?: string | null;
}) {
  const selected = shapes.find((s) => s.localId === selectedId) ?? null;
  const editingPoints = mode === "edit-points" && selected;

  return (
    <>
      {shapes.map((shape) => {
        if (shape.points.length < 2) return null;
        const style = styleFor(shape);
        const isSelected = shape.localId === selectedId;
        const isSplitTarget = shape.localId === splitHoverId;
        const center = boundingBoxCenter(shape.points);
        const Tag = shape.kind === "road" ? "polyline" : "polygon";

        function handleShapeDoubleClick(e: React.MouseEvent<SVGElement>) {
          if (mode !== "edit-points" || !isSelected) return;
          e.stopPropagation();
          const local = clientPointToLocalFraction(e.currentTarget as unknown as SVGGraphicsElement, e.clientX, e.clientY, VB);
          if (!local) return;
          const { afterIndex, point } = nearestEdgeInsertion(shape.points, local);
          onUpdateShape(shape.localId, insertVertex(shape.points, afterIndex, point));
        }

        return (
          <g key={shape.localId}>
            <Tag
              points={toSvgPoints(shape.points)}
              fill={style.fill}
              stroke={isSplitTarget ? "#f97316" : isSelected ? "#3b82f6" : style.stroke}
              strokeWidth={isSplitTarget || isSelected ? VB * 0.004 : VB * 0.002}
              strokeDasharray={style.dashed ? `${VB * 0.008} ${VB * 0.006}` : undefined}
              className="cursor-pointer"
              onClick={(e) => {
                // In Split-plot mode, a click on a shape is placing a cut
                // point, not selecting it — let it bubble up to the
                // canvas's own click handler (ReviewCanvas) instead of
                // being swallowed here. Every other mode keeps the normal
                // select-on-click behavior.
                if (mode === "split-plot") return;
                e.stopPropagation();
                onSelect(shape.localId);
              }}
              onDoubleClick={handleShapeDoubleClick}
            />
            {shape.label && (
              <text
                x={center.x}
                y={center.y}
                textAnchor="middle"
                fontSize={VB * 0.016}
                fill="#111827"
                className="pointer-events-none select-none font-medium"
                style={{ paintOrder: "stroke", stroke: "#ffffff", strokeWidth: VB * 0.003 }}
              >
                {shape.label}
              </text>
            )}
          </g>
        );
      })}

      {editingPoints &&
        selected.points.map((point, index) => (
          <VertexHandle
            key={index}
            x={point.x}
            y={point.y}
            onDrag={(next) => onUpdateShape(selected.localId, moveVertex(selected.points, index, next))}
            onDoubleClick={() => {
              if (selected.points.length <= MIN_POINTS[selected.kind]) return;
              onUpdateShape(selected.localId, deleteVertex(selected.points, index));
            }}
          />
        ))}
    </>
  );
}
