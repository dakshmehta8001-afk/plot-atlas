"use client";

// Viewer-facing map of a single floor's plate layout: renders every flat
// traced on that floor as an SVG polygon, colored by sale status, with the
// same click-to-zoom interaction as SitePlanViewer. Used inside
// BuildingDrilldown once a viewer has picked a floor from the floor
// selector.
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { MAP_VIEWBOX_SIZE, UNIT_STATUS_STYLES, type Unit } from "@/lib/types";
import { useImageAspectRatio } from "@/lib/useImageAspectRatio";
import { toScaledSvgPoints, scaledBoundingBoxCenter } from "@/lib/svgPolygon";

const VB = MAP_VIEWBOX_SIZE;
const ZOOM_SCALE = 3;
// See the matching constants/helper in SitePlanViewer.tsx.
const REVEAL_STEP_MS = 12;
const REVEAL_MAX_DELAY_MS = 400;
function revealDelay(index: number): number {
  return Math.min(index * REVEAL_STEP_MS, REVEAL_MAX_DELAY_MS);
}

// See the matching comment on SitePlanViewer's MapShapes: extracted so the
// hover-tooltip state (which changes on every mousemove while hovering a
// flat) doesn't force every flat's SVG points string to recompute on each
// of those events — invisible on a small floor plate, real on a floor with
// many flats.
const FlatShapes = memo(function FlatShapes({
  flats,
  vbHeight,
  onFlatClick,
  onFlatHover,
  onFlatHoverEnd,
}: {
  flats: Unit[];
  vbHeight: number;
  onFlatClick: (unit: Unit) => void;
  onFlatHover: (unit: Unit, e: React.MouseEvent) => void;
  onFlatHoverEnd: (unitId: string) => void;
}) {
  return (
    <>
      {flats.map((unit, index) => {
        if (unit.polygon_points.length < 3) return null;
        const style = UNIT_STATUS_STYLES[unit.status];
        return (
          <polygon
            key={unit.id}
            points={toScaledSvgPoints(unit.polygon_points, VB, vbHeight)}
            fill={style.fill}
            stroke={style.border}
            strokeWidth={VB * 0.0025}
            className="cursor-pointer transition-opacity hover:opacity-80"
            style={{ animation: "fadeIn 420ms ease-out backwards", animationDelay: `${revealDelay(index)}ms` }}
            onClick={() => onFlatClick(unit)}
            onMouseEnter={(e) => onFlatHover(unit, e)}
            onMouseMove={(e) => onFlatHover(unit, e)}
            onMouseLeave={() => onFlatHoverEnd(unit.id)}
          />
        );
      })}
    </>
  );
});

export function FloorPlanViewer({
  planImageUrl,
  flats,
  onFlatClick,
}: {
  planImageUrl: string;
  flats: Unit[];
  onFlatClick: (unit: Unit) => void;
}) {
  const [zoomedId, setZoomedId] = useState<string | null>(null);
  const aspectRatio = useImageAspectRatio(planImageUrl);
  // See the matching comment in SitePlanViewer.tsx: deriving the viewBox's
  // height from the floor plate image's real aspect ratio (instead of a
  // fixed square, stretched via preserveAspectRatio="none") is what keeps
  // any non-square floor plate from rendering distorted.
  const vbHeight = VB / aspectRatio;
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredUnit, setHoveredUnit] = useState<{ unit: Unit; x: number; y: number } | null>(null);

  const updateHoverPosition = useCallback((unit: Unit, e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHoveredUnit({ unit, x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, []);

  const handleFlatHoverEnd = useCallback((unitId: string) => {
    setHoveredUnit((prev) => (prev?.unit.id === unitId ? null : prev));
  }, []);

  const transform = useMemo(() => {
    const flat = flats.find((f) => f.id === zoomedId);
    if (!flat || flat.polygon_points.length < 3) return "translate(0px, 0px) scale(1)";
    const center = scaledBoundingBoxCenter(flat.polygon_points, VB, vbHeight);
    const targetX = VB / 2;
    const targetY = vbHeight / 2;
    const tx = targetX - ZOOM_SCALE * center.x;
    const ty = targetY - ZOOM_SCALE * center.y;
    return `translate(${tx}px, ${ty}px) scale(${ZOOM_SCALE})`;
  }, [flats, zoomedId, vbHeight]);

  const handleClick = useCallback(
    (unit: Unit) => {
      setZoomedId(unit.id);
      setHoveredUnit(null);
      onFlatClick(unit);
    },
    [onFlatClick],
  );

  return (
    <div ref={containerRef} className="relative h-full w-full">
      {zoomedId && (
        <button
          type="button"
          onClick={() => setZoomedId(null)}
          className="absolute right-3 top-3 z-10 rounded-md bg-white/90 px-3 py-1.5 text-sm font-medium text-[#0f2436] shadow hover:bg-white"
        >
          ← Back to floor view
        </button>
      )}
      <div className="h-full w-full overflow-hidden">
        <svg viewBox={`0 0 ${VB} ${vbHeight}`} className="h-full w-full bg-[#0b1f2e]">
          <g style={{ transform, transformOrigin: "0 0", transition: "transform 550ms var(--ease-cinematic)" }}>
            <image href={planImageUrl} x={0} y={0} width={VB} height={vbHeight} />
            <FlatShapes
              flats={flats}
              vbHeight={vbHeight}
              onFlatClick={handleClick}
              onFlatHover={updateHoverPosition}
              onFlatHoverEnd={handleFlatHoverEnd}
            />
          </g>
        </svg>
      </div>

      {!zoomedId && hoveredUnit && (
        <div
          className="pointer-events-none absolute z-[550] -translate-x-1/2 -translate-y-[calc(100%+10px)] whitespace-nowrap rounded-md border border-map-border bg-map-panel/95 px-2.5 py-1.5 text-xs text-white shadow-lg backdrop-blur"
          style={{ left: hoveredUnit.x, top: hoveredUnit.y }}
        >
          <span className="font-semibold">{hoveredUnit.unit.unit_number}</span>
          {hoveredUnit.unit.bhk_type && <span className="ml-1.5 text-white/60">{hoveredUnit.unit.bhk_type}</span>}
          <span className="ml-1.5 text-white/60">{UNIT_STATUS_STYLES[hoveredUnit.unit.status].label}</span>
        </div>
      )}
    </div>
  );
}
