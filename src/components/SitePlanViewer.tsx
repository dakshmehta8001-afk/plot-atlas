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
import { useEffect, useMemo, useState } from "react";
import {
  MAP_VIEWBOX_SIZE,
  SITE_FEATURE_STYLES,
  UNIT_STATUS_STYLES,
  zoneColorFor,
  type Building,
  type Road,
  type SiteFeature,
  type Unit,
} from "@/lib/types";
import { useImageAspectRatio } from "@/lib/useImageAspectRatio";
import { toSvgPoints, toSvgPathD, boundingBoxCenter } from "@/lib/svgPolygon";

const VB = MAP_VIEWBOX_SIZE;
const ZOOM_SCALE = 4;
export const BUILDING_ZOOM_TRANSITION_MS = 650;

// The point exactly halfway along a road's traced length — a road is an
// open path (often just two endpoints, sometimes bent), so a bounding-box
// center can land off the path entirely, and picking the middle VERTEX by
// array index is wrong too: a straight two-point road has no middle
// vertex, only its two endpoints, which is the common case this needs to
// get right. Walking the path by cumulative length instead works for any
// point count, including two.
function pathMidpoint(points: { x: number; y: number }[]): { x: number; y: number } {
  const px = points.map((p) => p.x * VB);
  const py = points.map((p) => p.y * VB);
  if (px.length === 1) return { x: px[0], y: py[0] };

  const segmentLengths: number[] = [];
  let totalLength = 0;
  for (let i = 1; i < px.length; i++) {
    const d = Math.hypot(px[i] - px[i - 1], py[i] - py[i - 1]);
    segmentLengths.push(d);
    totalLength += d;
  }
  if (totalLength === 0) return { x: px[0], y: py[0] };

  let remaining = totalLength / 2;
  for (let i = 0; i < segmentLengths.length; i++) {
    if (remaining <= segmentLengths[i]) {
      const t = remaining / segmentLengths[i];
      return { x: px[i] + (px[i + 1] - px[i]) * t, y: py[i] + (py[i + 1] - py[i]) * t };
    }
    remaining -= segmentLengths[i];
  }
  return { x: px[px.length - 1], y: py[px.length - 1] };
}

export function SitePlanViewer({
  planImageUrl,
  plots,
  buildings,
  roads = [],
  features = [],
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
  roads?: Road[];
  features?: SiteFeature[];
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

  // resetSignal only ever changes to a new value (never re-fires the same
  // one), so this only runs when the parent actually wants us reset — e.g.
  // BuildingDrilldown backing out of a floor view. Without this, zoomedId
  // stayed stuck on the last-clicked building/plot: the parent could swap
  // back to showing this component in full, but it would still render
  // zoomed into wherever that stale id pointed, with a stray "Back to full
  // view" button, since nothing here was actually watching resetSignal.
  useEffect(() => {
    if (resetSignal !== undefined) setZoomedId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately keyed only on the signal, not on its own identity
  }, [resetSignal]);

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
              transform,
              transformOrigin: "0 0",
              transition: "transform 600ms ease",
            }}
          >
            <image href={planImageUrl} x={0} y={0} width={VB} height={VB} preserveAspectRatio="none" />

            {roads.map((road, index) => {
              if (road.path_points.length < 2) return null;
              const mid = pathMidpoint(road.path_points);
              const motionPathId = `road-motion-${road.id}`;
              // Varying the duration a little per road, rather than one
              // fixed number, is what keeps several cars on screen at once
              // from all being in lockstep.
              const driveDuration = 7 + (index % 4) * 1.5;
              return (
                <g key={road.id} className="pointer-events-none">
                  {/* Rendered as real road styling (asphalt + lane markings),
                      not just a highlight — this is what makes a traced road
                      look like a road on ANY uploaded image, not only one
                      that already has road artwork drawn into it. */}
                  <polyline
                    points={toSvgPoints(road.path_points)}
                    fill="none"
                    stroke="#3a4552"
                    strokeWidth={VB * 0.026}
                    strokeLinecap="round"
                  />
                  <polyline
                    points={toSvgPoints(road.path_points)}
                    fill="none"
                    stroke="#e8eaed"
                    strokeWidth={VB * 0.0018}
                    strokeDasharray={`${VB * 0.014} ${VB * 0.01}`}
                    strokeLinecap="round"
                    opacity={0.8}
                  />

                  {/* An invisible copy of the same path, purely so the car
                      below has something to run animateMotion along —
                      <mpath> only works off a real <path>, not a <polyline>. */}
                  <path id={motionPathId} d={toSvgPathD(road.path_points)} fill="none" stroke="none" />
                  <g>
                    <rect
                      x={-VB * 0.011}
                      y={-VB * 0.0055}
                      width={VB * 0.022}
                      height={VB * 0.011}
                      rx={VB * 0.0025}
                      fill={index % 2 === 0 ? "#d7473f" : "#e7e7e2"}
                    />
                    <animateMotion
                      dur={`${driveDuration}s`}
                      repeatCount="indefinite"
                      rotate="auto"
                      keyPoints="0;1;0"
                      keyTimes="0;0.5;1"
                      calcMode="linear"
                    >
                      <mpath href={`#${motionPathId}`} />
                    </animateMotion>
                  </g>
                  {/* A backing rect behind the label so a road's width stays
                      legible over whatever the plan image looks like underneath. */}
                  <rect
                    x={mid.x - road.width_label.length * (VB * 0.0055)}
                    y={mid.y - VB * 0.013}
                    width={road.width_label.length * (VB * 0.011)}
                    height={VB * 0.022}
                    rx={VB * 0.004}
                    fill="#0f2436"
                    opacity={0.85}
                  />
                  <text
                    x={mid.x}
                    y={mid.y + VB * 0.003}
                    textAnchor="middle"
                    fontSize={VB * 0.014}
                    fill="#f5c94b"
                    className="select-none font-medium"
                  >
                    {road.width_label}
                  </text>
                </g>
              );
            })}

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

            {/* Parks/temples/gates/etc — informational only, no click-to-zoom
                (same lighter interaction level as buildings get relative to
                plots, since a feature isn't itself a sellable unit). */}
            {features.map((feature) => {
              if (feature.polygon_points.length < 3) return null;
              const style = SITE_FEATURE_STYLES[feature.kind];
              const center = boundingBoxCenter(feature.polygon_points);
              return (
                <g key={feature.id} className="pointer-events-none">
                  <polygon
                    points={toSvgPoints(feature.polygon_points)}
                    fill={style.fill}
                    stroke={style.border}
                    strokeWidth={VB * 0.002}
                  >
                    <title>{feature.label}</title>
                  </polygon>
                  <text
                    x={center.x}
                    y={center.y}
                    textAnchor="middle"
                    fontSize={VB * 0.016}
                    fill="#f8fafc"
                    className="select-none font-medium"
                  >
                    {feature.label}
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
