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
//
// Clicking a zone legend pill (ProjectMapClient's `toggleZone`) does two
// things at once, both already true before this file's own zone fly-in
// code was added: it sets `highlightZone` (dimming non-matching plots,
// above) AND always forces zoneColourMode on, which is what guarantees
// `highlightZone` is only ever non-null while colorMode is "zone" — i.e.
// the dimming-as-highlight effect above and the camera fly-in below always
// happen together, with no separate "highlight the zone" code needed here.
// If a future change ever lets `highlightZone` be set while colorMode is
// "status", the camera would still fly to the zone correctly, just without
// the visual dim/highlight — worth re-checking this comment's assumption
// then.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MAP_VIEWBOX_SIZE,
  SITE_FEATURE_STYLES,
  UNIT_STATUS_STYLES,
  zoneColorFor,
  type Building,
  type Road,
  type SiteFeature,
  type Unit,
  type UnitStatus,
} from "@/lib/types";
import { useImageAspectRatio } from "@/lib/useImageAspectRatio";
import { toScaledSvgPoints, toScaledSvgPathD, scaledBoundingBoxCenter } from "@/lib/svgPolygon";
import { clientPointToLocalFraction } from "@/lib/svgCoords";

const VB = MAP_VIEWBOX_SIZE;
const ZOOM_SCALE = 4;
// A per-shape stagger for the initial reveal animation (see the `animation`/
// `animationDelay` styles below) — capped so a large project's plots don't
// drag the reveal out for seconds; anything past the cap just joins the
// tail end of the cascade instead of continuing to spread out.
const REVEAL_STEP_MS = 12;
const REVEAL_MAX_DELAY_MS = 400;
function revealDelay(index: number): number {
  return Math.min(index * REVEAL_STEP_MS, REVEAL_MAX_DELAY_MS);
}
// Free-roam pan/zoom cap for the full-site view (separate from ZOOM_SCALE,
// which is the fixed scale the scripted click-to-zoom-a-shape animation
// always lands on). Kept lower than the digitize editor's 12x ceiling — this
// is a browsing aid over finished artwork, not a precision tracing tool.
const MAX_FREE_ZOOM = 6;
export const BUILDING_ZOOM_TRANSITION_MS = 650;
// Level-of-detail threshold: plot number labels and zone-accent dots stay
// hidden below this free-roam zoom scale (keeps the low-zoom overview
// clean, per the "avoid clutter" goal), and always show once a plot/
// building is actually selected (effective scale = ZOOM_SCALE, always
// "zoomed in enough"). Deliberately a boolean crossing point, not a
// continuous prop, passed down to MapShapes — React.memo only skips a
// re-render when a prop's VALUE is unchanged, and a boolean only changes
// when the threshold is actually crossed, not on every intermediate zoom
// tick, so this doesn't reintroduce the per-frame re-render cost the
// MapShapes extraction was built to avoid.
const LOD_LABEL_SCALE_THRESHOLD = 2;

// Zone fly-in: how much extra margin to leave around a zone's own bounding
// box when fitting the camera to it, as a fraction of the box's own
// width/height on EACH side — 0.35 means the padded box is 1.7x the zone's
// raw size, so the zone itself fills roughly 1/1.7 (~59%) of the frame,
// leaving genuine surrounding context (neighboring zones/plots/roads)
// visible rather than cropping tight to just the selected zone's plots.
// This is what satisfies "keep surrounding plots visible" — a tight fit
// would zoom in until nothing else was on screen, reading as a full screen
// swap rather than a fly-in within the same map.
const ZONE_FIT_PADDING = 0.35;
// Never zoom OUT past the full-site identity view for a zone fit (a zone
// spanning nearly the whole plan would otherwise compute a scale < 1,
// which would look like zooming AWAY from the site, backwards for a
// "fly INTO this zone" gesture) — and cap the zoom-IN side at the same
// ceiling the free-roam pinch/wheel zoom already uses (`MAX_FREE_ZOOM`),
// so a one-plot zone doesn't fly in absurdly tighter than a viewer could
// otherwise ever manually zoom to.
const ZONE_MIN_ZOOM = 1;

// Road width parsing: width_label is free text like "30 ft"/"150 ft" (see
// ROAD_WIDTH_PRESETS in types.ts), not a structured number, so a real site
// plan's 30 ft internal lane and 150 ft arterial road were previously
// rendered at the exact same flat stroke width — reading as visually
// identical even though the source plan (and the corridor-based detector,
// which now infers width_label from the traced corridor's actual gap) drew
// them very differently. Extracting the leading number and mapping it onto
// a clamped stroke-width range fixes that without needing a real-world
// scale reference (the map has none — see MAP_VIEWBOX_SIZE). Widths outside
// the clamp range still render (just pinned to the min/max look), and a
// missing/unparseable label falls back to the same flat width this used
// to always render at, so old/hand-traced roads without a usable label
// don't change appearance.
const ROAD_WIDTH_MIN_FT = 20;
const ROAD_WIDTH_MAX_FT = 200;
const ROAD_STROKE_MIN = VB * 0.012;
const ROAD_STROKE_MAX = VB * 0.05;
const ROAD_STROKE_DEFAULT = VB * 0.026;
function roadStrokeWidth(widthLabel: string): number {
  const match = widthLabel.match(/(\d+(?:\.\d+)?)/);
  if (!match) return ROAD_STROKE_DEFAULT;
  const feet = parseFloat(match[1]);
  if (!Number.isFinite(feet)) return ROAD_STROKE_DEFAULT;
  const clampedFeet = Math.min(ROAD_WIDTH_MAX_FT, Math.max(ROAD_WIDTH_MIN_FT, feet));
  const t = (clampedFeet - ROAD_WIDTH_MIN_FT) / (ROAD_WIDTH_MAX_FT - ROAD_WIDTH_MIN_FT);
  return ROAD_STROKE_MIN + t * (ROAD_STROKE_MAX - ROAD_STROKE_MIN);
}

// The point exactly halfway along a road's traced length — a road is an
// open path (often just two endpoints, sometimes bent), so a bounding-box
// center can land off the path entirely, and picking the middle VERTEX by
// array index is wrong too: a straight two-point road has no middle
// vertex, only its two endpoints, which is the common case this needs to
// get right. Walking the path by cumulative length instead works for any
// point count, including two.
function pathMidpoint(points: { x: number; y: number }[], vbWidth: number, vbHeight: number): { x: number; y: number } {
  const px = points.map((p) => p.x * vbWidth);
  const py = points.map((p) => p.y * vbHeight);
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

// Extracted specifically so pan/zoom (`view`) and hover-tooltip
// (`hoveredUnit`) state — both of which live in SitePlanViewer and change
// on nearly every pointermove/wheel event during a drag-pan, pinch, or
// hover — don't force a full re-render of every road/plot/building/feature
// on each of those events. A performance audit found this recomputing
// every shape's SVG points string (toScaledSvgPoints etc.) on every single
// frame of a pan/zoom gesture, invisible on a handful of demo plots but a
// real source of dropped frames on a real project with 100+ plots,
// especially on mobile (the least CPU headroom, and exactly where pinch-
// zoom makes this the most reachable). React.memo only helps if the props
// passed in are themselves stable across those re-renders — see the
// useCallback-wrapped handlers in SitePlanViewer below; plots/roads/etc.
// are already stable since they come from a Server Component fetch that
// doesn't re-run on client-side pan/zoom/hover.
const MapShapes = memo(function MapShapes({
  roads,
  plots,
  buildings,
  features,
  vbHeight,
  colorMode,
  zones,
  highlightZone,
  highlightStatus,
  selectedId,
  showLabels,
  onPlotClick,
  onBuildingClick,
  onPlotHover,
  onPlotHoverEnd,
}: {
  roads: Road[];
  plots: Unit[];
  buildings: Building[];
  features: SiteFeature[];
  vbHeight: number;
  colorMode: "status" | "zone";
  zones: string[];
  highlightZone: string | null;
  highlightStatus: UnitStatus | null;
  /** The currently zoomed-in plot/building id, if any — drives the
   * "selected plot glows, everything else dims" focus effect. */
  selectedId: string | null;
  /** Level-of-detail gate for plot number labels and zone-accent dots. */
  showLabels: boolean;
  onPlotClick: (unit: Unit) => void;
  onBuildingClick: (building: Building) => void;
  onPlotHover: (unit: Unit, e: React.MouseEvent) => void;
  onPlotHoverEnd: (unitId: string) => void;
}) {
  function plotStyle(unit: Unit): { fill: string; border: string; opacity: number; isSelected: boolean } {
    const isSelected = selectedId === unit.id;
    const dimmedBySelection = selectedId !== null && !isSelected;
    const statusDimmed = highlightStatus !== null && unit.status !== highlightStatus;
    if (colorMode === "zone") {
      const dimmed = dimmedBySelection || (highlightZone !== null && unit.category !== highlightZone) || statusDimmed;
      if (!unit.category) return { fill: "rgba(148,163,184,0.25)", border: "#64748b", opacity: dimmed ? 0.25 : 1, isSelected };
      const color = zoneColorFor(unit.category, zones);
      return { fill: `${color}59`, border: color, opacity: dimmed ? 0.25 : 1, isSelected };
    }
    const style = UNIT_STATUS_STYLES[unit.status];
    return { fill: style.fill, border: style.border, opacity: dimmedBySelection || statusDimmed ? 0.25 : 1, isSelected };
  }

  return (
    <>
      {roads.map((road, index) => {
        if (road.path_points.length < 2) return null;
        const mid = pathMidpoint(road.path_points, VB, vbHeight);
        const motionPathId = `road-motion-${road.id}`;
        // Varying the duration a little per road, rather than one
        // fixed number, is what keeps several cars on screen at once
        // from all being in lockstep.
        const driveDuration = 7 + (index % 4) * 1.5;
        // Both the asphalt strip and its dashed centerline scale off the
        // same parsed width, keeping the same proportions the flat-width
        // version had (a wider road gets a proportionally wider, not just
        // absolutely wider, centerline and dash pattern).
        const asphaltWidth = roadStrokeWidth(road.width_label);
        const centerlineWidth = asphaltWidth * 0.069;
        const dashLength = asphaltWidth * 0.54;
        const dashGap = asphaltWidth * 0.38;
        return (
          <g
            key={road.id}
            className="pointer-events-none"
            // Reveal-in on first mount only — `animationFillMode:
            // "backwards"` applies the from-keyframe during the
            // staggered delay (so later shapes don't flash at full
            // opacity before their turn), but does NOT persist after
            // the animation ends, so it can never permanently override
            // anything. Re-renders (toggling the zone/status filter,
            // etc.) don't replay this — it only plays once, when the
            // shape's own DOM node is first created, since none of
            // these props change on re-render. The plain `opacity` here
            // (separate from the animation) is what gives the "focus"
            // dimming when a plot/building is selected — the animation's
            // own opacity keyframe only controls the entrance and never
            // persists afterward (backwards, not forwards/both), so this
            // takes over cleanly once the reveal finishes.
            style={{
              animation: "fadeIn 420ms ease-out backwards",
              animationDelay: `${revealDelay(index)}ms`,
              opacity: selectedId !== null ? 0.4 : 1,
              transition: "opacity 300ms ease",
            }}
          >
            {/* Clean architectural/blueprint road styling — a light band
                (matching a printed site plan's plain "gap between plots"
                look, e.g. the Naman Infracity reference) with a thin
                dashed centerline, replacing the earlier dark-asphalt
                treatment. Still fully synthesized from the traced path
                (not the plan artwork itself), so this looks right on ANY
                uploaded image regardless of what that image already drew
                in its own road gaps. */}
            <polyline
              points={toScaledSvgPoints(road.path_points, VB, vbHeight)}
              fill="none"
              stroke="#eef1f4"
              strokeWidth={asphaltWidth}
              strokeLinecap="round"
            />
            <polyline
              points={toScaledSvgPoints(road.path_points, VB, vbHeight)}
              fill="none"
              stroke="#94a3b8"
              strokeWidth={centerlineWidth}
              strokeDasharray={`${dashLength} ${dashGap}`}
              strokeLinecap="round"
            />

            {/* An invisible copy of the same path, purely so the car
                below has something to run animateMotion along —
                <mpath> only works off a real <path>, not a <polyline>. */}
            <path id={motionPathId} d={toScaledSvgPathD(road.path_points, VB, vbHeight)} fill="none" stroke="none" />
            {/* A real, simple top-down 2D car — a rounded body, a darker
                windshield band across the middle (reads as "front/back"
                even at small map scale, which the old plain rect never
                did), and four small wheel marks at the corners. Bigger and
                fully opaque (the old rect was tiny and easy to miss), and
                driven noticeably slower (driveDuration below is roughly
                double the old per-road value) — both changes specifically
                so it's actually visible as a car while panning/zooming,
                not just a barely-noticeable colored speck. */}
            <g>
              <g
                style={{ animation: `fadeIn 420ms ease-out backwards`, animationDelay: `${revealDelay(index)}ms` }}
              >
                <rect x={-VB * 0.016} y={-VB * 0.0075} width={VB * 0.032} height={VB * 0.015} rx={VB * 0.004} fill={index % 2 === 0 ? "#d7473f" : "#f4f4f2"} stroke="#0f2436" strokeWidth={VB * 0.0009} />
                <rect x={-VB * 0.009} y={-VB * 0.005} width={VB * 0.018} height={VB * 0.006} rx={VB * 0.0015} fill="#0f2436" opacity={0.55} />
                <circle cx={-VB * 0.01} cy={-VB * 0.0075} r={VB * 0.0022} fill="#0f2436" />
                <circle cx={VB * 0.01} cy={-VB * 0.0075} r={VB * 0.0022} fill="#0f2436" />
                <circle cx={-VB * 0.01} cy={VB * 0.0075} r={VB * 0.0022} fill="#0f2436" />
                <circle cx={VB * 0.01} cy={VB * 0.0075} r={VB * 0.0022} fill="#0f2436" />
              </g>
              <animateMotion
                dur={`${driveDuration * 1.8}s`}
                repeatCount="indefinite"
                rotate="auto"
                keyPoints="0;1;0"
                keyTimes="0;0.5;1"
                calcMode="linear"
              >
                <mpath href={`#${motionPathId}`} />
              </animateMotion>
            </g>
            {/* A slow-walking pedestrian dot along the same motion path as
                the car — same <mpath> trick, deliberately NOT synced with
                it (a much longer duration, a staggered `begin` per road,
                and keyPoints inset slightly from the road's very endpoints
                rather than running the car's full length) so it reads as
                independent ambient life on the road rather than a second
                copy of the same car animation. This is the one small,
                genuinely optional touch from the "ambient life" item in the
                visual-polish pass — everything else on this map is
                functional; this purely make it feel inhabited. */}
            <g opacity={0.75}>
              <circle r={VB * 0.005} fill="#f4d9a0" stroke="#0f2436" strokeWidth={VB * 0.0012} />
              <animateMotion
                dur={`${driveDuration * 2.6}s`}
                repeatCount="indefinite"
                rotate="auto"
                keyPoints="0.05;0.95;0.05"
                keyTimes="0;0.5;1"
                calcMode="linear"
                begin={`${(index % 3) * 1.4}s`}
              >
                <mpath href={`#${motionPathId}`} />
              </animateMotion>
            </g>
            {/* Sitting directly on the road's own light band, matching
                the reference's plain look — a thin white halo (paintOrder
                stroke) keeps it legible without needing a solid dark
                pill behind it, now that the road itself is light rather
                than dark asphalt. */}
            <text
              x={mid.x}
              y={mid.y + VB * 0.003}
              textAnchor="middle"
              fontSize={VB * 0.013}
              fill="#334155"
              stroke="#eef1f4"
              strokeWidth={VB * 0.0035}
              paintOrder="stroke"
              className="select-none font-medium"
            >
              {road.width_label}
            </text>
          </g>
        );
      })}

      {plots.map((unit, index) => {
        if (unit.polygon_points.length < 3) return null;
        const style = plotStyle(unit);
        const center = scaledBoundingBoxCenter(unit.polygon_points, VB, vbHeight);
        const zoneColor = unit.category ? zoneColorFor(unit.category, zones) : null;
        return (
          <g key={unit.id}>
            <polygon
              points={toScaledSvgPoints(unit.polygon_points, VB, vbHeight)}
              fill={style.fill}
              stroke={style.border}
              strokeWidth={style.isSelected ? VB * 0.005 : VB * 0.002}
              opacity={style.opacity}
              // Hover glow/brighten is deliberately pure CSS (:hover, no
              // React state) — the selected-shape glow below is driven by
              // `selectedId`, which only changes on an actual click (rare),
              // but hover fires on every mousemove; doing it in CSS means
              // it costs nothing in React re-renders at all, keeping the
              // MapShapes-memoization perf fix from the last audit intact.
              // A scale-on-hover transform was deliberately left out: SVG
              // elements need transform-box:fill-box for a scale to
              // originate from the shape's own center rather than the
              // whole viewBox's corner, and getting that subtly wrong reads
              // as the shape jumping sideways, not growing in place — the
              // brighten+glow already reads as a clear hover response
              // without that risk.
              className="cursor-pointer transition-[opacity,filter] duration-200 hover:brightness-125 hover:[filter:drop-shadow(0_0_5px_rgba(255,255,255,0.55))]"
              style={{
                animation: "fadeIn 420ms ease-out backwards",
                animationDelay: `${revealDelay(index)}ms`,
                // Selected plot: a steady bright glow, distinct from the
                // momentary hover one — undefined (no inline filter at all)
                // when not selected, so the CSS hover rule above can still
                // apply freely (an inline style always wins over an
                // external stylesheet rule, selected or not, so leaving
                // this property OUT entirely when unselected is what lets
                // hover still work on every other plot).
                filter: style.isSelected ? "drop-shadow(0 0 10px rgba(255,255,255,0.85)) drop-shadow(0 0 20px rgba(96,165,250,0.6))" : undefined,
              }}
              onClick={() => onPlotClick(unit)}
              onMouseEnter={(e) => onPlotHover(unit, e)}
              onMouseMove={(e) => onPlotHover(unit, e)}
              onMouseLeave={() => onPlotHoverEnd(unit.id)}
            />
            {/* Zone/category accent — a small colored dot independent of
                colorMode, so "Premium"/"Corner"/"Standard" stays visually
                identifiable even while plots are colored by sale status.
                Gated by showLabels (LOD) same as the number label below,
                since it's the same "only show detail once zoomed in
                enough" clutter concern. */}
            {zoneColor && (
              <circle
                cx={unit.polygon_points[0].x * VB}
                cy={unit.polygon_points[0].y * vbHeight}
                r={VB * 0.008}
                fill={zoneColor}
                stroke="#0b1f2e"
                strokeWidth={VB * 0.0015}
                className="pointer-events-none"
                style={{ opacity: showLabels ? 1 : 0, transition: "opacity 300ms ease" }}
              />
            )}
            <text
              x={center.x}
              y={center.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={VB * 0.013}
              fill="#ffffff"
              stroke="#0b1f2e"
              strokeWidth={VB * 0.005}
              paintOrder="stroke"
              className="pointer-events-none select-none font-semibold"
              style={{ opacity: showLabels ? style.opacity : 0, transition: "opacity 300ms ease" }}
            >
              {unit.unit_number}
            </text>
          </g>
        );
      })}

      {buildings.map((building, index) => {
        if (building.polygon_points.length < 3) return null;
        const center = scaledBoundingBoxCenter(building.polygon_points, VB, vbHeight);
        const isSelected = selectedId === building.id;
        const dimmed = selectedId !== null && !isSelected;
        return (
          <g
            key={building.id}
            style={{
              animation: "fadeIn 420ms ease-out backwards",
              animationDelay: `${revealDelay(plots.length + index)}ms`,
              opacity: dimmed ? 0.25 : 1,
              transition: "opacity 300ms ease",
            }}
          >
            <polygon
              points={toScaledSvgPoints(building.polygon_points, VB, vbHeight)}
              fill="rgba(99,102,241,0.35)"
              stroke="#6366f1"
              strokeWidth={isSelected ? VB * 0.005 : VB * 0.0025}
              strokeDasharray={`${VB * 0.006} ${VB * 0.004}`}
              className="cursor-pointer transition-[filter] duration-200 hover:brightness-125 hover:[filter:drop-shadow(0_0_5px_rgba(255,255,255,0.55))]"
              style={{
                filter: isSelected
                  ? "drop-shadow(0 0 10px rgba(255,255,255,0.85)) drop-shadow(0 0 20px rgba(96,165,250,0.6))"
                  : undefined,
              }}
              onClick={() => onBuildingClick(building)}
            >
              <title>{building.name}</title>
            </polygon>
            <text
              x={center.x}
              y={center.y}
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
      {features.map((feature, index) => {
        if (feature.polygon_points.length < 3) return null;
        const style = SITE_FEATURE_STYLES[feature.kind];
        const center = scaledBoundingBoxCenter(feature.polygon_points, VB, vbHeight);
        return (
          <g
            key={feature.id}
            className="pointer-events-none"
            style={{
              animation: "fadeIn 420ms ease-out backwards",
              animationDelay: `${revealDelay(plots.length + buildings.length + index)}ms`,
              opacity: selectedId !== null ? 0.4 : 1,
              transition: "opacity 300ms ease",
            }}
          >
            <polygon
              points={toScaledSvgPoints(feature.polygon_points, VB, vbHeight)}
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
    </>
  );
});

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
  highlightStatus = null,
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
  /** When set, dims every plot whose status doesn't match — independent of
   * colorMode, so the status filter works whether plots are colored by
   * status or by zone. */
  highlightStatus?: UnitStatus | null;
  /** Bump this (e.g. with Date.now()) to force the view back to the full site, e.g. when the parent returns from a floor view. */
  resetSignal?: number;
}) {
  const [zoomedId, setZoomedId] = useState<string | null>(null);
  const aspectRatio = useImageAspectRatio(planImageUrl);
  // The viewBox's own height, derived from the plan image's real aspect
  // ratio — keeping width fixed at VB (1000) and deriving height this way,
  // combined with the SVG's default preserveAspectRatio ("xMidYMid meet"
  // — see the <svg> below, which no longer overrides it to "none"), is what
  // makes the plan render at its true proportions instead of stretched to
  // fill whatever shape the surrounding panel happens to be. Every x
  // position still multiplies by VB and every y position by vbHeight —
  // since both axes now map to the SAME number of screen pixels per unit
  // (that's the whole point of matching the viewBox to the real aspect
  // ratio), a "uniform size" value like a stroke-width or font-size stays
  // correct as a plain VB-based fraction, unchanged, on either axis.
  const vbHeight = VB / aspectRatio;

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

  // Free-roam pan/zoom over the full-site view — separate state from the
  // scripted zoomedShapePoints/transform below, which stays untouched. Only
  // active while zoomedId is null: the moment a plot/building is clicked,
  // the scripted zoom-to-shape animation takes over completely, so this
  // resets to identity on every zoomedId change (in either direction) and
  // on resetSignal, meaning the scripted animation always starts from a
  // clean, unpanned base rather than compounding with leftover pan/zoom.
  const [view, setView] = useState({ tx: 0, ty: 0, scale: 1 });
  const panGroupRef = useRef<SVGGElement>(null);
  const panState = useRef<{ startX: number; startY: number; origTx: number; origTy: number } | null>(null);
  // Every currently-down pointer, keyed by pointerId — Pointer Events unify
  // mouse/touch/pen, so tracking them this way (rather than a single "is
  // panning" boolean) is what lets one finger fall through to the existing
  // single-pointer pan below, while two simultaneously down switches into a
  // pinch-zoom gesture instead.
  const activePointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchState = useRef<{ distance: number } | null>(null);
  // Styled hover tooltip for plots, replacing the native browser <title> —
  // (x, y) are relative to containerRef's own box, not the viewport, so the
  // tooltip can be positioned with plain `left`/`top` regardless of where
  // this component sits on the page.
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredUnit, setHoveredUnit] = useState<{ unit: Unit; x: number; y: number } | null>(null);

  // Wrapped in useCallback (stable across the pan/zoom/hover re-renders
  // this component has often) so they can be passed as props into the
  // React.memo-wrapped MapShapes below without defeating its memoization —
  // a fresh function identity on every render would make React.memo's prop
  // comparison always see "something changed" and re-render anyway.
  const updateHoverPosition = useCallback((unit: Unit, e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHoveredUnit({ unit, x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, []);

  const handlePlotHoverEnd = useCallback((unitId: string) => {
    setHoveredUnit((prev) => (prev?.unit.id === unitId ? null : prev));
  }, []);

  useEffect(() => {
    setView({ tx: 0, ty: 0, scale: 1 });
    // Also reset on highlightZone changing (entering a zone, leaving one, or
    // switching straight from one zone to another) — otherwise a viewer's
    // leftover manual pan/zoom from browsing the last zone would compose
    // with the NEXT zone's fresh fit-to-box transform below, landing
    // somewhere neither transform intended.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately keyed only on zoomedId/resetSignal/highlightZone, not view's own identity
  }, [zoomedId, resetSignal, highlightZone]);

  function handleWheel(e: React.WheelEvent<SVGSVGElement>) {
    if (zoomedId) return;
    e.preventDefault();
    const group = panGroupRef.current;
    if (!group) return;
    // A viewBoxSize of 1 makes clientPointToLocalFraction hand back raw
    // local SVG units (no division) rather than a 0..1 fraction — needed
    // here since x and y no longer share one uniform unit scale (VB vs
    // vbHeight), and this helper only ever divides by a single size.
    const rawLocal = clientPointToLocalFraction(group, e.clientX, e.clientY, 1);
    if (!rawLocal) return;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setView((prev) => {
      const nextScale = Math.min(MAX_FREE_ZOOM, Math.max(1, prev.scale * factor));
      // Keep the point under the cursor fixed on screen while zooming — same
      // algebra as the digitize editor's wheel-zoom, just anchored to
      // whatever the pointer/touch position is instead of a clicked shape.
      const px = rawLocal.x;
      const py = rawLocal.y;
      const tx = px - ((px - prev.tx) / prev.scale) * nextScale;
      const ty = py - ((py - prev.ty) / prev.scale) * nextScale;
      return { tx, ty, scale: nextScale };
    });
  }

  function handleBackgroundPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (zoomedId) return;
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    (e.target as Element).setPointerCapture(e.pointerId);

    if (activePointers.current.size === 2) {
      // A second finger just landed — hand off from single-finger pan (if
      // one was in progress) to a pinch gesture.
      panState.current = null;
      const [a, b] = [...activePointers.current.values()];
      pinchState.current = { distance: Math.hypot(b.x - a.x, b.y - a.y) };
    } else if (activePointers.current.size === 1) {
      panState.current = { startX: e.clientX, startY: e.clientY, origTx: view.tx, origTy: view.ty };
    }
  }

  function handleBackgroundPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!activePointers.current.has(e.pointerId)) return;
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.current.size === 2 && pinchState.current) {
      const group = panGroupRef.current;
      if (!group) return;
      const [a, b] = [...activePointers.current.values()];
      const distance = Math.hypot(b.x - a.x, b.y - a.y);
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const factor = distance / pinchState.current.distance;
      pinchState.current.distance = distance;

      // Same "keep a screen point fixed while scale changes" algebra as
      // handleWheel, just re-anchored to the pinch midpoint every move
      // event instead of a stationary cursor — recomputing the anchor from
      // the CURRENT (pre-update) transform each event, rather than fixing
      // it once at gesture start, is what lets a pinch pan (both fingers
      // drifting together) and zoom (fingers spreading/pinching) compose
      // into one gesture without tracking them as two separate things.
      const rawLocal = clientPointToLocalFraction(group, midX, midY, 1);
      if (!rawLocal) return;
      setView((prev) => {
        const nextScale = Math.min(MAX_FREE_ZOOM, Math.max(1, prev.scale * factor));
        const px = rawLocal.x;
        const py = rawLocal.y;
        const tx = px - ((px - prev.tx) / prev.scale) * nextScale;
        const ty = py - ((py - prev.ty) / prev.scale) * nextScale;
        return { tx, ty, scale: nextScale };
      });
      return;
    }

    if (!panState.current) return;
    const dx = e.clientX - panState.current.startX;
    const dy = e.clientY - panState.current.startY;
    setView((prev) => ({ ...prev, tx: panState.current!.origTx + dx, ty: panState.current!.origTy + dy }));
  }

  function handleBackgroundPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    activePointers.current.delete(e.pointerId);

    if (activePointers.current.size < 2) {
      pinchState.current = null;
    }
    if (activePointers.current.size === 1) {
      // One finger lifted off during a pinch — resume a plain single-finger
      // pan from here rather than freezing until it's lifted too.
      const [[, remaining]] = [...activePointers.current.entries()];
      panState.current = { startX: remaining.x, startY: remaining.y, origTx: view.tx, origTy: view.ty };
    } else if (activePointers.current.size === 0) {
      panState.current = null;
    }
  }

  function zoomBy(factor: number) {
    setView((prev) => {
      const nextScale = Math.min(MAX_FREE_ZOOM, Math.max(1, prev.scale * factor));
      const centerX = VB / 2;
      const centerY = vbHeight / 2;
      const tx = centerX - ((centerX - prev.tx) / prev.scale) * nextScale;
      const ty = centerY - ((centerY - prev.ty) / prev.scale) * nextScale;
      return { tx, ty, scale: nextScale };
    });
  }
  function resetView() {
    setView({ tx: 0, ty: 0, scale: 1 });
  }

  const zoomedShapePoints = useMemo(() => {
    const plot = plots.find((p) => p.id === zoomedId);
    if (plot) return plot.polygon_points;
    const building = buildings.find((b) => b.id === zoomedId);
    return building?.polygon_points ?? null;
  }, [plots, buildings, zoomedId]);

  // Zone fly-in: the union bounding box of every valid plot belonging to
  // `highlightZone` (the SAME prop the zone legend's dim/highlight filter
  // above already uses — see the class comment at the top of this file for
  // why that also means colorMode is already "zone" whenever this is set).
  // Deliberately built from `plots` only (standalone units), matching the
  // spec this was built against: a zone's camera target is the bounding
  // box of its MEMBER UNITS' existing polygon_points — no new geometry, no
  // schema change, nothing invented. A plot with fewer than 3 points is the
  // same "invalid shape" guard the render loop below already uses (it
  // wouldn't render as a polygon either), so it's excluded from the bounds
  // calc too rather than skewing it with a degenerate point.
  const highlightZoneBounds = useMemo(() => {
    if (!highlightZone) return null;
    const memberPoints = plots
      .filter((p) => p.category === highlightZone && p.polygon_points.length >= 3)
      .flatMap((p) => p.polygon_points);
    if (memberPoints.length === 0) return null;
    const xs = memberPoints.map((p) => p.x * VB);
    const ys = memberPoints.map((p) => p.y * vbHeight);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  }, [plots, highlightZone, vbHeight]);

  // The fit-to-box camera transform for whichever zone is highlighted, or
  // null if there isn't one (or its bounds turned out unusable — a zone
  // whose only members have missing/invalid polygon data, or a single
  // point repeated so the box has zero width/height) — the null case is
  // the "gracefully fall back to the existing camera behavior" requirement:
  // `transform` below just treats it the same as "no zone selected."
  const zoneTransform = useMemo(() => {
    if (!highlightZoneBounds) return null;
    const { minX, maxX, minY, maxY } = highlightZoneBounds;
    const boxWidth = maxX - minX;
    const boxHeight = maxY - minY;
    if (boxWidth <= 0 || boxHeight <= 0) return null;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const paddedWidth = boxWidth * (1 + 2 * ZONE_FIT_PADDING);
    const paddedHeight = boxHeight * (1 + 2 * ZONE_FIT_PADDING);
    // Fit (min of the two axis scales), not fill (max) — fill would crop
    // whichever axis is relatively narrower to fill the frame completely,
    // cutting off real content on that axis; fit guarantees the WHOLE
    // padded box (and therefore every member plot) stays on screen.
    const fitScale = Math.min(VB / paddedWidth, vbHeight / paddedHeight);
    const scale = Math.min(MAX_FREE_ZOOM, Math.max(ZONE_MIN_ZOOM, fitScale));
    const targetX = VB / 2;
    const targetY = vbHeight / 2;
    const tx = targetX - scale * centerX;
    const ty = targetY - scale * centerY;
    return `translate(${tx}px, ${ty}px) scale(${scale})`;
  }, [highlightZoneBounds, vbHeight]);

  const transform = useMemo(() => {
    // A zoomed-in plot/building always wins over a zone fly-in — this is
    // exactly the "click Building/Plot" step of the Site → Zone → Building
    // flow, and this branch is completely unchanged from before zone
    // fly-in existed, so that existing Building → Floor → Flat behavior
    // stays untouched.
    if (zoomedShapePoints && zoomedShapePoints.length >= 3) {
      const center = scaledBoundingBoxCenter(zoomedShapePoints, VB, vbHeight);
      const targetX = VB / 2;
      const targetY = vbHeight / 2;
      // Combined translate+scale so the zoomed shape's center lands in the
      // middle of the viewBox: translate(A - s*C) scale(s) applied to a
      // point p gives s*p + (A - s*C) = s*(p - C) + A, i.e. C maps to A.
      const tx = targetX - ZOOM_SCALE * center.x;
      const ty = targetY - ZOOM_SCALE * center.y;
      return `translate(${tx}px, ${ty}px) scale(${ZOOM_SCALE})`;
    }
    if (zoneTransform) return zoneTransform;
    return "translate(0px, 0px) scale(1)";
  }, [zoomedShapePoints, vbHeight, zoneTransform]);

  const handlePlotClick = useCallback(
    (unit: Unit) => {
      setZoomedId(unit.id);
      setHoveredUnit(null);
      onPlotClick(unit);
    },
    [onPlotClick],
  );

  const handleBuildingClick = useCallback(
    (building: Building) => {
      setZoomedId(building.id);
      // Let the zoom-in transition play out before telling the parent to
      // swap to the floor selector, so the building visually "opens up"
      // rather than the floor UI just appearing instantly.
      window.setTimeout(() => onBuildingSettled(building), BUILDING_ZOOM_TRANSITION_MS);
    },
    [onBuildingSettled],
  );

  return (
    <div ref={containerRef} className="relative h-full w-full">
      {zoomedId && (
        <button
          type="button"
          onClick={() => setZoomedId(null)}
          className="absolute right-3 top-3 z-10 rounded-md bg-white/90 px-3 py-1.5 text-sm font-medium text-[#0f2436] shadow hover:bg-white"
        >
          ← Back to full view
        </button>
      )}
      {/* No CSS aspectRatio style here any more — with both h-full and
          w-full set, that property has no effect (it only computes a
          missing dimension, and neither is missing here), which is
          actually how this used to silently stretch every plan image to
          whatever shape the panel happened to be. The SVG's own viewBox
          (below) now carries the real aspect ratio instead, so it
          letterboxes/pillarboxes correctly inside this box via the default
          preserveAspectRatio regardless of the box's own shape. */}
      <div className="h-full w-full overflow-hidden">
        <svg
          viewBox={`0 0 ${VB} ${vbHeight}`}
          className="h-full w-full bg-[#0b1f2e]"
          style={{ cursor: zoomedId ? "default" : "grab", touchAction: zoomedId ? "auto" : "none" }}
          onWheel={handleWheel}
          onPointerDown={handleBackgroundPointerDown}
          onPointerMove={handleBackgroundPointerMove}
          onPointerUp={handleBackgroundPointerUp}
          onPointerCancel={handleBackgroundPointerUp}
        >
          {/* Free-roam pan/zoom group (identity while a plot/building is
              zoomed-in via the scripted animation below) wraps the existing
              scripted zoom-to-shape group unchanged, so the two compose
              without either needing to know about the other. */}
          <g ref={panGroupRef} style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`, transformOrigin: "0 0" }}>
          <g
            style={{
              transform,
              transformOrigin: "0 0",
              transition: "transform 650ms var(--ease-cinematic)",
            }}
          >
            <image href={planImageUrl} x={0} y={0} width={VB} height={vbHeight} />

            <MapShapes
              roads={roads}
              plots={plots}
              buildings={buildings}
              features={features}
              vbHeight={vbHeight}
              colorMode={colorMode}
              zones={zones}
              highlightZone={highlightZone}
              highlightStatus={highlightStatus}
              selectedId={zoomedId}
              // Also show labels once a zone fly-in has happened, even
              // though `view` (the free-roam layer) itself resets to
              // identity scale on every zone change (see the effect
              // above) — without this, flying into a zone would still
              // hide plot numbers until the viewer ALSO manually
              // wheel/pinch-zoomed past the LOD threshold, defeating the
              // point of "Zone context → click Building/Plot" needing to
              // actually read the plot numbers to pick one.
              showLabels={zoomedId !== null || zoneTransform !== null || view.scale >= LOD_LABEL_SCALE_THRESHOLD}
              onPlotClick={handlePlotClick}
              onBuildingClick={handleBuildingClick}
              onPlotHover={updateHoverPosition}
              onPlotHoverEnd={handlePlotHoverEnd}
            />
          </g>
          </g>
        </svg>
      </div>

      {!zoomedId && hoveredUnit && (
        <div
          className="pointer-events-none absolute z-[550] -translate-x-1/2 -translate-y-[calc(100%+10px)] whitespace-nowrap rounded-md border border-map-border bg-map-panel/95 px-2.5 py-1.5 text-xs text-white shadow-lg backdrop-blur"
          style={{ left: hoveredUnit.x, top: hoveredUnit.y }}
        >
          <span className="font-semibold">
            {hoveredUnit.unit.wing ? `${hoveredUnit.unit.wing}-` : ""}
            {hoveredUnit.unit.unit_number}
          </span>
          <span className="ml-1.5 text-white/60">{UNIT_STATUS_STYLES[hoveredUnit.unit.status].label}</span>
        </div>
      )}

      {!zoomedId && (
        <div className="absolute bottom-3 right-3 z-10 flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => zoomBy(1.3)}
            aria-label="Zoom in"
            className="flex h-11 w-11 items-center justify-center rounded-md bg-white/90 text-lg font-semibold text-[#0f2436] shadow hover:bg-white"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => zoomBy(1 / 1.3)}
            aria-label="Zoom out"
            className="flex h-11 w-11 items-center justify-center rounded-md bg-white/90 text-lg font-semibold text-[#0f2436] shadow hover:bg-white"
          >
            −
          </button>
          <button
            type="button"
            onClick={resetView}
            aria-label="Fit to view"
            className="flex h-11 items-center justify-center rounded-md bg-white/90 px-2 text-xs font-medium text-[#0f2436] shadow hover:bg-white"
          >
            Fit
          </button>
        </div>
      )}
    </div>
  );
}
