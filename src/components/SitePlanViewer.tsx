"use client";

// Viewer-facing (read-only) map of a project's master site plan: renders
// every standalone plot AND every building's footprint as SVG polygons over
// the uploaded plan image. Clicking a plot smoothly zooms/pans from the
// full-site view down to it (CSS transition on an inner <g>'s transform —
// no 3D engine, per the "keep it 2D/cosmetic" scope decision) and opens its
// info card. Clicking a building does the same zoom, then — once the zoom
// settles — hands off to the parent (BuildingDrilldown) to swap in the
// floor selector; that hand-off, not this component, is what makes the
// building "become" a floor view.
//
// Two coloring modes for plots, matching the MapBhoomi-style zone legend in
// ProjectMapClient: "status" (default) colors each polygon by its sale
// status; "zone" colors by its category/zone tag instead, dimming anything
// that doesn't match `highlightZone` when the viewer has clicked a legend
// pill to filter. Buildings always render in a neutral indigo "structure"
// style since they aren't themselves bought/sold.
import { useMemo, useState } from "react";
import { MAP_VIEWBOX_SIZE, UNIT_STATUS_STYLES, zoneColorFor, type Building, type Unit } from "@/lib/types";
import { useImageAspectRatio } from "@/lib/useImageAspectRatio";
import { toSvgPoints, boundingBoxCenter } from "@/lib/svgPolygon";

const VB = MAP_VIEWBOX_SIZE;
const ZOOM_SCALE = 4;
export const BUILDING_ZOOM_TRANSITION_MS = 650;

export function SitePlanViewer({
  planImageUrl,
  plots,
  buildings,
  onPlotClick,
  onBuildingSettled,
  colorMode = "status",
  zones = [],
  highlightZone = null,
  resetSignal,
}: {
  planImageUrl: string;
  plots: Unit[];
  buildings: Building[];
  onPlotClick: (unit: Unit) => void;
  onBuildingSettled: (building: Building) => void;
  colorMode?: "status" | "zone";
  zones?: string[];
  highlightZone?: string | null;
  /** Bump this (e.g. with Date.now()) to force the view back to the full site, e.g. when the parent returns from a floor view. */
  resetSignal?: number;
}) {
  const [zoomedId, setZoomedId] = useState<string | null>(null);
  const aspectRatio = useImageAspectRatio(planImageUrl);

  const zoomedShapePoints = useMemo(() => {
    const plot = plots.find((p) => p.id === zoomedId);
    if (plot) return plot.polygon_points;
    const building = buildings.find((b) => b.id === zoomedId);
    return building?.polygon_points ?? null;
  }, [plots, buildings, zoomedId]);

  const transform = useMemo(() => {
    if (!zoomedShapePoints || zoomedShapePoints.length < 3) {
      return "translate(0px, 0px) scale(1)";
    }
    const center = boundingBoxCenter(zoomedShapePoints);
    const target = VB / 2;
    // Combined translate+scale so the zoomed shape's center lands in the
    // middle of the viewBox: translate(A - s*C) scale(s) applied to a point
    // p gives s*p + (A - s*C) = s*(p - C) + A, i.e. C maps to A.
    const tx = target - ZOOM_SCALE * center.x;
    const ty = target - ZOOM_SCALE * center.y;
    return `translate(${tx}px, ${ty}px) scale(${ZOOM_SCALE})`;
  }, [zoomedShapePoints]);

  function handlePlotClick(unit: Unit) {
    setZoomedId(unit.id);
    onPlotClick(unit);
  }

  function handleBuildingClick(building: Building) {
    setZoomedId(building.id);
    // Let the zoom-in transition play out before telling the parent to swap
    // to the floor selector, so the building visually "opens up" rather
    // than the floor UI just appearing instantly.
    window.setTimeout(() => onBuildingSettled(building), BUILDING_ZOOM_TRANSITION_MS);
  }

  function plotStyle(unit: Unit): { fill: string; border: string; opacity: number } {
    if (colorMode === "zone") {
      const dimmed = highlightZone !== null && unit.category !== highlightZone;
      if (!unit.category) return { fill: "rgba(148,163,184,0.25)", border: "#64748b", opacity: dimmed ? 0.3 : 1 };
      const color = zoneColorFor(unit.category, zones);
      return { fill: `${color}59`, border: color, opacity: dimmed ? 0.3 : 1 };
    }
    const style = UNIT_STATUS_STYLES[unit.status];
    return { fill: style.fill, border: style.border, opacity: 1 };
  }

  return (
    <div className="relative h-full w-full">
      {zoomedId && (
        <button
          type="button"
          onClick={() => setZoomedId(null)}
          className="absolute right-3 top-3 z-10 rounded-md bg-white/90 px-3 py-1.5 text-sm font-medium text-[#0f2436] shadow hover:bg-white"
        >
          ← Back to full view
        </button>
      )}
      <div className="h-full w-full overflow-hidden" style={{ aspectRatio }}>
        <svg viewBox={`0 0 ${VB} ${VB}`} preserveAspectRatio="none" className="h-full w-full bg-[#0b1f2e]">
          <g
            style={{
              transform: resetSignal !== undefined && !zoomedId ? "translate(0px, 0px) scale(1)" : transform,
              transformOrigin: "0 0",
              transition: "transform 600ms ease",
            }}
          >
            <image href={planImageUrl} x={0} y={0} width={VB} height={VB} preserveAspectRatio="none" />

            {plots.map((unit) => {
              if (unit.polygon_points.length < 3) return null;
              const style = plotStyle(unit);
              return (
                <polygon
                  key={unit.id}
                  points={toSvgPoints(unit.polygon_points)}
                  fill={style.fill}
                  stroke={style.border}
                  strokeWidth={VB * 0.002}
                  opacity={style.opacity}
                  className="cursor-pointer transition-opacity hover:opacity-80"
                  onClick={() => handlePlotClick(unit)}
                >
                  <title>{unit.unit_number}</title>
                </polygon>
              );
            })}

            {buildings.map((building) => {
              if (building.polygon_points.length < 3) return null;
              return (
                <g key={building.id}>
                  <polygon
                    points={toSvgPoints(building.polygon_points)}
                    fill="rgba(99,102,241,0.35)"
                    stroke="#6366f1"
                    strokeWidth={VB * 0.0025}
                    strokeDasharray={`${VB * 0.006} ${VB * 0.004}`}
                    className="cursor-pointer transition-opacity hover:opacity-80"
                    onClick={() => handleBuildingClick(building)}
                  >
                    <title>{building.name}</title>
                  </polygon>
                  <text
                    x={boundingBoxCenter(building.polygon_points).x}
                    y={boundingBoxCenter(building.polygon_points).y}
                    textAnchor="middle"
                    fontSize={VB * 0.02}
                    fill="#e0e7ff"
                    className="pointer-events-none select-none font-semibold"
                  >
                    {building.name}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </div>
  );
}
