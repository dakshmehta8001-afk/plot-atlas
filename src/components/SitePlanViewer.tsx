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
  onPlotClick: (unit: Unit) => void;
  onBuildingClick: (building: Building) => void;
  onPlotHover: (unit: Unit, e: React.MouseEvent) => void;
  onPlotHoverEnd: (unitId: string) => void;
}) {
  function plotStyle(unit: Unit): { fill: string; border: string; opacity: number } {
    const statusDimmed = highlightStatus !== null && unit.status !== highlightStatus;
    if (colorMode === "zone") {
      const dimmed = (highlightZone !== null && unit.category !== highlightZone) || statusDimmed;
      if (!unit.category) return { fill: "rgba(148,163,184,0.25)", border: "#64748b", opacity: dimmed ? 0.3 : 1 };
      const color = zoneColorFor(unit.category, zones);
      return { fill: `${color}59`, border: color, opacity: dimmed ? 0.3 : 1 };
    }
    const style = UNIT_STATUS_STYLES[unit.status];
    return { fill: style.fill, border: style.border, opacity: statusDimmed ? 0.3 : 1 };
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
            // these props change on re-render.
            style={{ animation: "fadeIn 420ms ease-out backwards", animationDelay: `${revealDelay(index)}ms` }}
          >
            {/* Rendered as real road styling (asphalt + lane markings),
                not just a highlight — this is what makes a traced road
                look like a road on ANY uploaded image, not only one
                that already has road artwork drawn into it. */}
            <polyline
              points={toScaledSvgPoints(road.path_points, VB, vbHeight)}
              fill="none"
              stroke="#3a4552"
              strokeWidth={VB * 0.026}
              strokeLinecap="round"
            />
            <polyline
              points={toScaledSvgPoints(road.path_points, VB, vbHeight)}
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
            <path id={motionPathId} d={toScaledSvgPathD(road.path_points, VB, vbHeight)} fill="none" stroke="none" />
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

      {plots.map((unit, index) => {
        if (unit.polygon_points.length < 3) return null;
        const style = plotStyle(unit);
        return (
          <polygon
            key={unit.id}
            points={toScaledSvgPoints(unit.polygon_points, VB, vbHeight)}
            fill={style.fill}
            stroke={style.border}
            strokeWidth={VB * 0.002}
            opacity={style.opacity}
            className="cursor-pointer transition-opacity hover:opacity-80"
            style={{ animation: "fadeIn 420ms ease-out backwards", animationDelay: `${revealDelay(index)}ms` }}
            onClick={() => onPlotClick(unit)}
            onMouseEnter={(e) => onPlotHover(unit, e)}
            onMouseMove={(e) => onPlotHover(unit, e)}
            onMouseLeave={() => onPlotHoverEnd(unit.id)}
          />
        );
      })}

      {buildings.map((building, index) => {
        if (building.polygon_points.length < 3) return null;
        const center = scaledBoundingBoxCenter(building.polygon_points, VB, vbHeight);
        return (
          <g
            key={building.id}
            style={{ animation: "fadeIn 420ms ease-out backwards", animationDelay: `${revealDelay(plots.length + index)}ms` }}
          >
            <polygon
              points={toScaledSvgPoints(building.polygon_points, VB, vbHeight)}
              fill="rgba(99,102,241,0.35)"
              stroke="#6366f1"
              strokeWidth={VB * 0.0025}
              strokeDasharray={`${VB * 0.006} ${VB * 0.004}`}
              className="cursor-pointer transition-opacity hover:opacity-80"
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately keyed only on zoomedId/resetSignal, not view's own identity
  }, [zoomedId, resetSignal]);

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

  const transform = useMemo(() => {
    if (!zoomedShapePoints || zoomedShapePoints.length < 3) {
      return "translate(0px, 0px) scale(1)";
    }
    const center = scaledBoundingBoxCenter(zoomedShapePoints, VB, vbHeight);
    const targetX = VB / 2;
    const targetY = vbHeight / 2;
    // Combined translate+scale so the zoomed shape's center lands in the
    // middle of the viewBox: translate(A - s*C) scale(s) applied to a point
    // p gives s*p + (A - s*C) = s*(p - C) + A, i.e. C maps to A.
    const tx = targetX - ZOOM_SCALE * center.x;
    const ty = targetY - ZOOM_SCALE * center.y;
    return `translate(${tx}px, ${ty}px) scale(${ZOOM_SCALE})`;
  }, [zoomedShapePoints, vbHeight]);

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
