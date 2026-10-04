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
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  MAP_VIEWBOX_SIZE,
  SITE_FEATURE_STYLES,
  UNIT_STATUS_STYLES,
  zoneColorFor,
  type Building,
  type MapCalibration,
  type Road,
  type SiteFeature,
  type Unit,
  type UnitStatus,
} from "@/lib/types";
import { useImageAspectRatio } from "@/lib/useImageAspectRatio";
import { toScaledSvgPoints, scaledBoundingBoxCenter } from "@/lib/svgPolygon";
import { Compass } from "@/components/Compass";
import { buildScene, type Scene } from "@/lib/mapScenery";
import { roadLabelText } from "@/lib/roadWidth";
import { feetPerUnit } from "@/lib/calibration";
import { EDGE_INSET, EDGE_LINE, GATE_ROAD_ID, cornerAsphaltRadius, roadMetrics } from "@/lib/mapTraffic";
import { MapTraffic } from "@/components/MapTraffic";
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

// Strips the alpha channel from an "rgba(r,g,b,a)" string, e.g.
// "rgba(34,197,94,0.35)" -> "rgb(34,197,94)". UNIT_STATUS_STYLES/
// SITE_FEATURE_STYLES's fill colors were designed as translucent overlays
// meant to sit on top of the uploaded plan photo underneath — since that
// photo is no longer rendered here at all (this is now a fully redrawn
// flat map, not shapes traced over a visible photo — see the removed
// <image> below), blending at 35% opacity against nothing just reads as
// washed-out gray-navy. Rendering the SAME hue at full opacity instead is
// what actually makes a plot read as a clean, flat color the way the
// reference site plan's own artwork does.
function opaqueRgba(rgba: string): string {
  const match = rgba.match(/rgba\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return rgba;
  return `rgb(${match[1]}, ${match[2]}, ${match[3]})`;
}

// ---- Scenery (ground, wall, trees, road surface) ----
// Cars and walkers are moved by <MapTraffic> (lib/mapTraffic.ts holds the
// road graph and simulation); this file only draws their sprites (below) and
// the road surface they drive on. Road cross-section constants (edge line,
// pavement strip, lanes) live in lib/mapTraffic.ts so drawing and traffic
// always agree.
// Medium-grey asphalt (not black), so cars, walkers and the white road markings all read on it.
const ROAD_COLOR = "#6b7078";
const PAVEMENT_COLOR = "#c8ccd2";

// Shared drawings, defined once and drawn many times with <use>: that keeps
// the DOM small (one tree = one <use>, not five shapes) which is what keeps
// panning smooth on a low-end phone.
function SceneryDefs() {
  return (
    <defs>
      {/* Blur for the soft shadows under streetlights and the gate arch. */}
      <filter id="sp-soft-shadow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="1.4" />
      </filter>
      <linearGradient id="sp-grass" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#8fcf8a" />
        <stop offset="1" stopColor="#6fb26f" />
      </linearGradient>
      {/* Zone mode: sold / booked / hold plots get diagonal stripes in their
          status colour over the zone fill, so sale status stays readable. */}
      <pattern id="sp-stripe-sold" patternUnits="userSpaceOnUse" width="14" height="14" patternTransform="rotate(45)">
        <rect width="6" height="14" fill="#ef4444" opacity="0.9" />
      </pattern>
      <pattern id="sp-stripe-booked" patternUnits="userSpaceOnUse" width="14" height="14" patternTransform="rotate(45)">
        <rect width="6" height="14" fill="#3b82f6" opacity="0.9" />
      </pattern>
      <pattern id="sp-stripe-hold" patternUnits="userSpaceOnUse" width="14" height="14" patternTransform="rotate(45)">
        <rect width="6" height="14" fill="#facc15" opacity="0.9" />
      </pattern>
      <g id="sp-tree-a">
        <circle cx="1.5" cy="2.5" r="10" fill="#000" opacity="0.22" />
        <circle r="10" fill="#2f7a3f" />
        <circle cx="-2" cy="-2.5" r="7" fill="#3f9a4f" />
        <circle cx="-3.5" cy="-4" r="3.6" fill="#62b86a" opacity="0.85" />
      </g>
      <g id="sp-tree-b">
        <circle cx="1.5" cy="2.5" r="9.5" fill="#000" opacity="0.22" />
        <circle cx="-4.5" cy="0" r="5.5" fill="#276b37" />
        <circle cx="4.5" cy="0" r="5.5" fill="#276b37" />
        <circle cx="0" cy="-4.5" r="5.5" fill="#2d7a40" />
        <circle cx="0" cy="4.5" r="5.5" fill="#276b37" />
        <circle cx="0" cy="0" r="5.5" fill="#3a9150" />
        <circle cx="-1.5" cy="-1.5" r="2.4" fill="#62b86a" opacity="0.8" />
      </g>
      {/* Top-down car, nose pointing +x. Body colour comes from the <use>'s
          `color` (currentColor); glass, lights, mirrors and wheels are fixed. */}
      <g id="sp-car">
        <ellipse cx="1" cy="2" rx="21" ry="10" fill="#000" opacity="0.28" />
        <rect x="-12" y="-9.8" width="7" height="2.4" rx="1" fill="#111" />
        <rect x="9" y="-9.8" width="7" height="2.4" rx="1" fill="#111" />
        <rect x="-12" y="7.4" width="7" height="2.4" rx="1" fill="#111" />
        <rect x="9" y="7.4" width="7" height="2.4" rx="1" fill="#111" />
        <path
          d="M-20,-5.6 Q-20,-8.75 -15,-8.75 L13,-8.75 Q20,-8.2 20,-4 L20,4 Q20,8.2 13,8.75 L-15,8.75 Q-20,8.75 -20,5.6 Z"
          fill="currentColor"
          stroke="#000"
          strokeOpacity="0.45"
          strokeWidth="0.8"
        />
        <path d="M3.5,-6.6 L10.5,-5.2 L10.5,5.2 L3.5,6.6 Z" fill="#1b2a38" opacity="0.88" />
        <path d="M-12.5,-6.2 L-8.5,-6.8 L-8.5,6.8 L-12.5,6.2 Z" fill="#1b2a38" opacity="0.88" />
        <rect x="-8.5" y="-6.6" width="12" height="13.2" rx="2" fill="#fff" opacity="0.2" />
        <path d="M10.5,-7.4 L16.5,-6.2 M10.5,7.4 L16.5,6.2" stroke="#000" strokeOpacity="0.25" strokeWidth="0.7" />
        <rect x="17.4" y="-7.4" width="2.6" height="3.2" rx="1" fill="#fff6c8" />
        <rect x="17.4" y="4.2" width="2.6" height="3.2" rx="1" fill="#fff6c8" />
        <rect x="-20" y="-7.4" width="2" height="3.2" rx="0.8" fill="#ff3b30" />
        <rect x="-20" y="4.2" width="2" height="3.2" rx="0.8" fill="#ff3b30" />
        <rect x="4.5" y="-10.4" width="3" height="2" rx="0.8" fill="#222" />
        <rect x="4.5" y="8.4" width="3" height="2" rx="0.8" fill="#222" />
      </g>
      {/* Top-down scooter with a rider, nose pointing +x. 16 long = 40% of the
          car sprite. Body colour comes from the <use>'s `color`. */}
      <g id="sp-bike">
        <ellipse cx="0.5" cy="1" rx="8.6" ry="4.4" fill="#000" opacity="0.28" />
        <rect x="-8" y="-1" width="5" height="2" rx="1" fill="#111" />
        <rect x="3.2" y="-1" width="5" height="2" rx="1" fill="#111" />
        <rect x="-6.4" y="-2.3" width="11.4" height="4.6" rx="2.2" fill="currentColor" stroke="#000" strokeOpacity="0.4" strokeWidth="0.5" />
        <path d="M3.6,-3.9 L3.6,3.9" stroke="#222" strokeWidth="1" strokeLinecap="round" />
        <path d="M-0.4,-2.4 L3.6,-3.5 M-0.4,2.4 L3.6,3.5" stroke="#374151" strokeWidth="1.3" strokeLinecap="round" />
        <ellipse cx="-1" cy="0" rx="2" ry="3.5" fill="#374151" stroke="#000" strokeOpacity="0.35" strokeWidth="0.4" />
        <circle cx="0.4" cy="0" r="1.9" fill="#f8fafc" stroke="#000" strokeOpacity="0.4" strokeWidth="0.4" />
        <rect x="7.4" y="-1.2" width="0.9" height="2.4" rx="0.4" fill="#fff6c8" />
        <rect x="-8.3" y="-1" width="0.8" height="2" rx="0.4" fill="#ff3b30" />
      </g>
      {/* Top-down walker facing +x: shoulders, arms, head, hair. */}
      <g id="sp-walker">
        <ellipse cx="0.5" cy="1.2" rx="5" ry="8.2" fill="#000" opacity="0.25" />
        <ellipse cx="0.5" cy="-6.6" rx="2.2" ry="1.7" fill="#e9c4a0" />
        <ellipse cx="0.5" cy="6.6" rx="2.2" ry="1.7" fill="#e9c4a0" />
        <ellipse cx="0" cy="0" rx="3.4" ry="7" fill="currentColor" stroke="#000" strokeOpacity="0.4" strokeWidth="0.6" />
        <circle cx="1" cy="0" r="3.5" fill="#e9c4a0" stroke="#000" strokeOpacity="0.35" strokeWidth="0.5" />
        <path d="M-2.3,-2.2 A3.5,3.5 0 0 0 -2.3,2.2 Q0.8,0 -2.3,-2.2 Z" fill="#2b2118" />
      </g>
    </defs>
  );
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
// The entry gate: two stone pillars at the kerbs and a beam across the road
// carrying the project name, seen from above, with a soft shadow. Drawn in a
// frame whose x axis runs ACROSS the road, so the same shapes fit any road
// direction (the angle keeps the name upright).
function GateArch({ gate, name }: { gate: NonNullable<Scene["gate"]>; name: string }) {
  const half = gate.width / 2;
  const text = (name.trim() || "Entrance").slice(0, 34) + (name.trim().length > 34 ? "…" : "");
  const avail = gate.width - 38;
  const natural = text.length * 5.6; // about 9px type
  return (
    <g transform={`translate(${gate.x} ${gate.y}) rotate(${gate.angle})`}>
      <g filter="url(#sp-soft-shadow)" fill="#000" fillOpacity={0.3}>
        <rect x={-half + 3} y={-8} width={gate.width - 4} height={20} rx={3} />
        <rect x={-half + 1} y={-11} width={15} height={26} rx={2} />
        <rect x={half - 14} y={-11} width={15} height={26} rx={2} />
      </g>
      {/* beam over the road */}
      <rect x={-half + 8} y={-9} width={gate.width - 16} height={18} rx={3} fill="#e4d6b8" stroke="#7a6548" strokeWidth={0.8} />
      <rect x={-half + 8} y={-9} width={gate.width - 16} height={4} rx={2} fill="#ffffff" fillOpacity={0.35} />
      {/* pillars */}
      <rect x={-half - 1} y={-12} width={15} height={24} rx={2} fill="#a8946f" stroke="#5e4c33" strokeWidth={0.9} />
      <rect x={half - 14} y={-12} width={15} height={24} rx={2} fill="#a8946f" stroke="#5e4c33" strokeWidth={0.9} />
      <rect x={-half + 2} y={-9} width={9} height={18} rx={1.5} fill="#c4b08a" />
      <rect x={half - 11} y={-9} width={9} height={18} rx={1.5} fill="#c4b08a" />
      <text
        x={0}
        y={0.5}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={9}
        fontWeight={700}
        fill="#2b2118"
        textLength={natural > avail ? avail : undefined}
        lengthAdjust="spacingAndGlyphs"
        className="select-none"
      >
        {text}
      </text>
    </g>
  );
}

const MapShapes = memo(function MapShapes({
  roads,
  scene,
  projectName,
  plots,
  buildings,
  features,
  vbHeight,
  colorMode,
  zones,
  highlightZone,
  highlightStatus,
  selectedId,
  ftPerUnit,
  onPlotClick,
  onBuildingClick,
  onPlotHover,
  onPlotHoverEnd,
}: {
  roads: Road[];
  /** Roads, junctions, gate and streetlights, built once by SitePlanViewer. */
  scene: Scene;
  /** Shown on the entry gate's arch. */
  projectName: string;
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
  /** Feet per map unit from the project's scale, or null when it has none (used to work out a road's width label). */
  ftPerUnit: number | null;
  onPlotClick: (unit: Unit) => void;
  onBuildingClick: (building: Building) => void;
  onPlotHover: (unit: Unit, e: React.MouseEvent) => void;
  onPlotHoverEnd: (unitId: string) => void;
}) {
  const plotGeoms = useMemo(() => {
    const map = new Map<string, { points: string; center: { x: number; y: number }; minDim: number }>();
    for (const unit of plots) {
      if (unit.polygon_points.length < 3) continue;
      const xs = unit.polygon_points.map((p) => p.x * VB);
      const ys = unit.polygon_points.map((p) => p.y * vbHeight);
      map.set(unit.id, {
        points: toScaledSvgPoints(unit.polygon_points, VB, vbHeight),
        center: scaledBoundingBoxCenter(unit.polygon_points, VB, vbHeight),
        minDim: Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)),
      });
    }
    return map;
  }, [plots, vbHeight]);

  // Road widths painted on the asphalt. Each one is ~11 screen pixels tall at
  // every zoom (counter-scaled by --k, see the labels layer comment) but never
  // taller than 70% of that road's on-screen width: the scale is the SMALLER of
  // 1/--k (constant 11px) and 0.7*roadWidth/11 (shrinks on narrow roads or
  // when zoomed far out), so a label can never spill onto a plot.
  const painted = useMemo(
    () =>
      scene.roads.flatMap((r) => {
        if (r.id === GATE_ROAD_ID) return [];
        const text = roadLabelText(r.label, r.width, ftPerUnit);
        if (!text) return [];
        const css = {
          transform: `translate(${r.labelPos.x}px, ${r.labelPos.y}px) rotate(${r.labelPos.angle}deg) scale(min(calc(1 / var(--k, 0.4)), ${((0.7 * r.width) / 11).toFixed(4)}))`,
        } as React.CSSProperties;
        return [{ id: r.id, text, w: text.length * 6.8 + 12, css }];
      }),
    [scene.roads, ftPerUnit],
  );

  // Junctions where the dashed centre line must stop: any node where roads
  // cross or meet (3+ edges, or two different roads). The cut disc reaches the
  // far edge of the widest road there. Plain bends along one road stay dashed.
  // The site boundary for the road layer: the outer edges of the perimeter
  // roads. Corner fillets and road ends are cut flush to it, so asphalt never
  // pokes out past the site. (Each segment only widens the box sideways.)
  const roadClip = useMemo(() => {
    const env = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    const gate = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const e of scene.network.edges) {
      const box = e.roadId === GATE_ROAD_ID ? gate : env;
      for (let i = 1; i < e.pts.length; i++) {
        const a = e.pts[i - 1];
        const b = e.pts[i];
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const padX = (e.width / 2) * (Math.abs(b.y - a.y) / len);
        const padY = (e.width / 2) * (Math.abs(b.x - a.x) / len);
        box.x0 = Math.min(box.x0, a.x - padX, b.x - padX);
        box.x1 = Math.max(box.x1, a.x + padX, b.x + padX);
        box.y0 = Math.min(box.y0, a.y - padY, b.y - padY);
        box.y1 = Math.max(box.y1, a.y + padY, b.y + padY);
      }
    }
    if (!Number.isFinite(env.x0)) return null;
    // Round the outer corners with the same radius as the corner fillets, so
    // the straight road edges and the fillets meet with nothing sticking out.
    const rx = scene.corners.length ? Math.min(...scene.corners.map((c) => c.width)) / 2 : 0;
    return {
      x: env.x0,
      y: env.y0,
      w: env.x1 - env.x0,
      h: env.y1 - env.y0,
      rx,
      // The gate's approach road leads OUT of the site, so it is allowed past the envelope.
      approach: Number.isFinite(gate.x0) ? { x: gate.x0, y: gate.y0, w: gate.x1 - gate.x0, h: gate.y1 - gate.y0 } : null,
    };
  }, [scene.network, scene.corners]);

  const junctions = useMemo(
    () =>
      scene.network.nodes
        .filter((n) => n.edges.length >= 3 || (n.edges.length === 2 && scene.network.edges[n.edges[0]].roadId !== scene.network.edges[n.edges[1]].roadId))
        .map((n) => ({ id: n.id, x: n.x, y: n.y, r: Math.max(...n.edges.map((e) => scene.network.edges[e].width)) / 2 })),
    [scene.network],
  );

  function plotStyle(unit: Unit): { fill: string; border: string; opacity: number; isSelected: boolean } {
    const isSelected = selectedId === unit.id;
    const dimmedBySelection = selectedId !== null && !isSelected;
    const statusDimmed = highlightStatus !== null && unit.status !== highlightStatus;
    const dimmed = dimmedBySelection || statusDimmed;
    // A commercial/office block reads as visually distinct regardless of
    // colorMode — the same idea as a building always rendering in a fixed
    // indigo "structure" color instead of status/zone color. Teal picked
    // specifically to not collide with any UNIT_STATUS_STYLES or zone
    // palette color already in use. Checked before the zone/status branches
    // below so neither can override it.
    if (unit.category && /\b(commercial|office)\b/i.test(unit.category)) {
      return { fill: "rgb(20,184,166)", border: "#0d9488", opacity: dimmed ? 0.25 : 1, isSelected };
    }
    if (colorMode === "zone") {
      const dimmed = dimmedBySelection || (highlightZone !== null && unit.category !== highlightZone) || statusDimmed;
      if (!unit.category) return { fill: "rgb(148,163,184)", border: "#64748b", opacity: dimmed ? 0.25 : 1, isSelected };
      const color = zoneColorFor(unit.category, zones);
      return { fill: color, border: color, opacity: dimmed ? 0.25 : 1, isSelected };
    }
    const style = UNIT_STATUS_STYLES[unit.status];
    return { fill: opaqueRgba(style.fill), border: style.border, opacity: dimmedBySelection || statusDimmed ? 0.25 : 1, isSelected };
  }

  return (
    <>
      <SceneryDefs />

      {/* Ground: soft grass under the whole site, a boundary wall, and rows
          of trees just inside the wall and beside the roads. */}
      {scene.ground && (
        <g className="pointer-events-none">
          <rect x={scene.ground.x} y={scene.ground.y} width={scene.ground.w} height={scene.ground.h} rx={14} fill="url(#sp-grass)" />
          <rect x={scene.ground.wall.x} y={scene.ground.wall.y} width={scene.ground.wall.w} height={scene.ground.wall.h} rx={6} fill="none" stroke="#5f5a50" strokeWidth={7} />
          <rect x={scene.ground.wall.x} y={scene.ground.wall.y} width={scene.ground.wall.w} height={scene.ground.wall.h} rx={6} fill="none" stroke="#d9d3c5" strokeWidth={4.4} />
          <rect x={scene.ground.wall.x} y={scene.ground.wall.y} width={scene.ground.wall.w} height={scene.ground.wall.h} rx={6} fill="none" stroke="#f1ede3" strokeWidth={1} strokeOpacity={0.9} />
          {scene.trees.map((t, i) => (
            <use key={i} href={t.variant === 1 ? "#sp-tree-b" : "#sp-tree-a"} transform={`translate(${t.x} ${t.y}) scale(${t.scale})`} />
          ))}
        </g>
      )}

      {/* Roads, drawn in passes across ALL roads so crossings stay clean:
          asphalt rim -> white edge line -> pavement strip -> carriageway ->
          yellow dashes. Each road is as wide as the real gap between the plot
          blocks either side of it (measured in buildScene) and its ends are
          extended to meet the roads they join (display only). The whole layer
          is clipped to the site boundary (the wall), so no road pokes out. */}
      {roadClip && (
        <defs>
          <clipPath id="sp-site-clip">
            <rect x={roadClip.x} y={roadClip.y} width={roadClip.w} height={roadClip.h} rx={roadClip.rx} />
            {roadClip.approach && <rect x={roadClip.approach.x} y={roadClip.approach.y} width={roadClip.approach.w} height={roadClip.approach.h} />}
          </clipPath>
        </defs>
      )}
      <g
        className="pointer-events-none"
        clipPath={roadClip ? "url(#sp-site-clip)" : undefined}
        style={{ animation: "fadeIn 420ms ease-out backwards", opacity: selectedId !== null ? 0.4 : 1, transition: "opacity 300ms ease" }}
      >
        {scene.roads.map((r) => (
          <polyline key={`rim-${r.id}`} points={r.points} fill="none" stroke={ROAD_COLOR} strokeWidth={r.width} strokeLinejoin="round" />
        ))}
        {scene.corners.map((c, i) => (
          <circle key={`rimc-${i}`} cx={c.x} cy={c.y} r={c.width / 2} fill={ROAD_COLOR} />
        ))}
        {scene.roads.map((r) => (
          <polyline key={`edge-${r.id}`} points={r.points} fill="none" stroke="#f1f3f5" strokeWidth={Math.max(1, r.width - 2 * EDGE_INSET)} strokeLinejoin="round" />
        ))}
        {scene.corners.map((c, i) => (
          <circle key={`edgec-${i}`} cx={c.x} cy={c.y} r={Math.max(0.5, (c.width - 2 * EDGE_INSET) / 2)} fill="#f1f3f5" />
        ))}
        {scene.roads.map((r) => (
          <polyline key={`pave-${r.id}`} points={r.points} fill="none" stroke={PAVEMENT_COLOR} strokeWidth={Math.max(1, r.width - 2 * (EDGE_INSET + EDGE_LINE))} strokeLinejoin="round" />
        ))}
        {scene.corners.map((c, i) => (
          <circle key={`pavec-${i}`} cx={c.x} cy={c.y} r={Math.max(0.5, (c.width - 2 * (EDGE_INSET + EDGE_LINE)) / 2)} fill={PAVEMENT_COLOR} />
        ))}
        {/* Thin white edge lines on both sides of the driving surface. */}
        {scene.roads.map((r) => (
          <polyline key={`cline-${r.id}`} points={r.points} fill="none" stroke="#ffffff" strokeOpacity={0.92} strokeWidth={roadMetrics(r.width).carriageway + 2.6} strokeLinejoin="round" />
        ))}
        {scene.corners.map((c, i) => (
          <circle key={`clinec-${i}`} cx={c.x} cy={c.y} r={cornerAsphaltRadius(c.width) + 1.3} fill="#ffffff" fillOpacity={0.92} />
        ))}
        {scene.roads.map((r) => (
          <polyline key={`lane-${r.id}`} points={r.points} fill="none" stroke={ROAD_COLOR} strokeWidth={roadMetrics(r.width).carriageway} strokeLinejoin="round" />
        ))}
        {scene.corners.map((c, i) => (
          <circle key={`lanec-${i}`} cx={c.x} cy={c.y} r={cornerAsphaltRadius(c.width)} fill={ROAD_COLOR} />
        ))}
        <g mask="url(#sp-centre-mask)">
        {scene.roads.map((r) => (
          <polyline
            key={`centre-${r.id}`}
            points={r.points}
            fill="none"
            stroke="#ffffff"
            strokeOpacity={0.92}
            strokeWidth={Math.max(1.3, r.width * 0.026)}
            strokeDasharray={`${Math.max(5, r.width * 0.09)} ${Math.max(8, r.width * 0.13)}`}
            strokeLinejoin="round"
          />
        ))}
        </g>
      </g>

      {/* Road widths PAINTED on the asphalt: white bold text on the centre line,
          mid-block, rotated along the road, ~90% opaque so it reads as paint.
          Drawn above the road surface but below cars, walkers and plots. The
          dashed centre line is cut away under each label by the mask above. */}
      <defs>
        <mask id="sp-centre-mask" maskUnits="userSpaceOnUse" x={-100} y={-100} width={VB + 200} height={vbHeight + 200}>
          <rect x={-100} y={-100} width={VB + 200} height={vbHeight + 200} fill="#fff" />
          {junctions.map((j) => (
            <circle key={`jcut-${j.id}`} cx={j.x} cy={j.y} r={j.r} fill="#000" />
          ))}
          {painted.map((l) => (
            <g key={`cut-${l.id}`} style={l.css}>
              <rect x={-l.w / 2} y={-8} width={l.w} height={16} fill="#000" />
            </g>
          ))}
        </mask>
      </defs>
      <g
        className="pointer-events-none"
        clipPath={roadClip ? "url(#sp-site-clip)" : undefined}
        style={{ opacity: selectedId !== null ? 0.4 : 1, transition: "opacity 300ms ease" }}
      >
        {painted.map((l) => (
          <g key={`paint-${l.id}`} style={l.css}>
            <text textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={800} fill="#ffffff" fillOpacity={0.9} className="select-none">
              {l.text}
            </text>
          </g>
        ))}
      </g>

      {/* Cars and walkers: one animation loop (see MapTraffic), not SVG
          animateMotion, so they follow the road network and turn. */}
      <g style={{ opacity: selectedId !== null ? 0.4 : 1, transition: "opacity 300ms ease" }}>
        <MapTraffic network={scene.network} seedKey={roads.map((r) => r.id).join("|")} />
      </g>

      {/* Overhead things, drawn above the traffic: streetlights along the
          inner road edges (pole on the kerb, a short arm reaching over the
          road, a soft shadow) and the entry gate's arch with the project name. */}
      <g className="pointer-events-none" style={{ opacity: selectedId !== null ? 0.4 : 1, transition: "opacity 300ms ease" }}>
        {scene.lights.length > 0 && (
          <g filter="url(#sp-soft-shadow)">
            {scene.lights.map((l, i) => (
              <g key={`lts-${i}`} fill="#000" fillOpacity={0.3} stroke="#000" strokeOpacity={0.3}>
                <line x1={l.x + 1.8} y1={l.y + 2.8} x2={l.ax + 1.8} y2={l.ay + 2.8} strokeWidth={2.2} strokeLinecap="round" />
                <circle cx={l.ax + 1.8} cy={l.ay + 2.8} r={3.6} stroke="none" fillOpacity={0.22} />
              </g>
            ))}
          </g>
        )}
        {scene.lights.map((l, i) => (
          <g key={`lt-${i}`}>
            <line x1={l.x} y1={l.y} x2={l.ax} y2={l.ay} stroke="#2f343d" strokeWidth={1.1} strokeLinecap="round" />
            <circle cx={l.x} cy={l.y} r={1.7} fill="#2f343d" stroke="#ffffff" strokeOpacity={0.55} strokeWidth={0.4} />
            <circle cx={l.ax} cy={l.ay} r={2.3} fill="#ffe9a6" stroke="#2f343d" strokeWidth={0.5} />
          </g>
        ))}
        {scene.gate && <GateArch gate={scene.gate} name={projectName} />}
      </g>

      {plots.map((unit, index) => {
        if (unit.polygon_points.length < 3) return null;
        const geom = plotGeoms.get(unit.id);
        if (!geom) return null;
        const style = plotStyle(unit);
        return (
          <g key={unit.id}>
            <polygon
              points={geom.points}
              fill={style.fill}
              // A real bug found via live testing, not a style nicety: once
              // fills went fully opaque (see opaqueRgba above), a plot's
              // own status-color border (a few shades darker than its own
              // fill — fine against the OLD translucent blend, where the
              // border was the only genuinely saturated part) stopped
              // reading at all between two ADJACENT plots sharing the SAME
              // status — the overwhelmingly common case (e.g. a freshly
              // digitized project where every plot starts "Available").
              // Two near-identical greens separated by a thin same-hue
              // line is visually indistinguishable from one solid green
              // blob — exactly what made a real 112-plot project's entire
              // grid vanish into a single shape with no internal
              // boundaries visible at all. A fixed, neutral, dark
              // separator (independent of status/zone color) is what
              // every plot boundary actually needs; the status/zone color
              // still does its job entirely through the fill itself. The
              // selected plot keeps its colored ring (a deliberate, single
              // highlight a reviewer is meant to notice, not a boundary
              // meant to generically separate neighbors).
              stroke={style.isSelected ? style.border : "#0f2436"}
              strokeWidth={style.isSelected ? VB * 0.005 : VB * 0.0022}
              strokeOpacity={style.isSelected ? 1 : 0.55}
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
            {/* Zone mode only: sold / booked / hold plots get diagonal stripes
                over the zone colour so sale status stays readable. In status
                mode (Zone off) plots are plain status colours with no zone
                borders. Plot numbers are drawn in the labels layer at the end. */}
            {colorMode === "zone" && (unit.status === "sold" || unit.status === "booked" || unit.status === "hold") && (
              <polygon
                points={geom.points}
                fill={`url(#sp-stripe-${unit.status})`}
                className="pointer-events-none"
                style={{ opacity: style.opacity }}
              />
            )}
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
              fill="rgb(99,102,241)"
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
        // The gate is drawn as an arch over the road (above), not as a flat polygon.
        if (feature.kind === "gate" && scene.gate) return null;
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
              fill={opaqueRgba(style.fill)}
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

      {/* Labels, drawn last so nothing covers them (plots, cars, walkers). Both
          kinds keep a CONSTANT on-screen size at every zoom: the SVG carries a
          CSS variable --k (screen pixels per map unit, set from
          SitePlanViewer on zoom and resize), and each label scales itself by
          1/--k, so 11 in a label's own units is always 11 screen pixels. Pure
          CSS, so zooming never re-renders these shapes. */}
      <g className="pointer-events-none">
        {plots.map((unit) => {
          const geom = plotGeoms.get(unit.id);
          if (!geom || !unit.unit_number) return null;
          const style = plotStyle(unit);
          // A plot number fades out only if its plot is smaller than ~14 px
          // on screen, so tiny plots never pile numbers on top of each other.
          const css = {
            transform: `translate(${geom.center.x}px, ${geom.center.y}px) scale(calc(1 / var(--k, 0.4)))`,
            opacity: `calc(${style.opacity} * clamp(0, calc((var(--k, 0.4) * ${geom.minDim.toFixed(1)} - 12) / 6), 1))`,
            transition: "opacity 300ms ease",
          } as React.CSSProperties;
          return (
            <g key={`num-${unit.id}`} style={css}>
              <text
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={11}
                fontWeight={800}
                fill="#ffffff"
                stroke="#0b1f2e"
                strokeWidth={3}
                paintOrder="stroke"
                className="select-none"
              >
                {unit.unit_number}
              </text>
            </g>
          );
        })}
      </g>
    </>
  );
});

export function SitePlanViewer({
  planImageUrl,
  planImageSize,
  projectName = "",
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
  calibration = null,
  resetSignal,
}: {
  planImageUrl: string;
  /** Stored pixel size of the plan image, so the map has its real shape from the first render. */
  planImageSize?: { width?: number | null; height?: number | null };
  /** Shown on the entry gate's arch, if the project has a gate. */
  projectName?: string;
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
  /** The project's map scale; lets road labels show a real width when a road has no number saved. */
  calibration?: MapCalibration | null;
  /** Bump this (e.g. with Date.now()) to force the view back to the full site, e.g. when the parent returns from a floor view. */
  resetSignal?: number;
}) {
  const [zoomedId, setZoomedId] = useState<string | null>(null);
  const aspectRatio = useImageAspectRatio(planImageUrl, planImageSize);
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

  // The entry gate is a site feature of kind "gate" that the sub-admin draws on
  // a perimeter road. With none (or none on a perimeter road) nothing is drawn
  // and there is no entry traffic. The scene is built here, once per data
  // change, so the fit frame below can include the gate's approach road.
  const gatePoints = useMemo(() => features.find((f) => f.kind === "gate" && f.polygon_points.length >= 3)?.polygon_points ?? null, [features]);
  const scene = useMemo(
    () => buildScene(roads, plots, [...buildings, ...features.filter((f) => f.kind !== "gate")], VB, vbHeight, roadStrokeWidth, gatePoints),
    [roads, plots, buildings, features, vbHeight, gatePoints],
  );

  // The visible frame ("Fit"): the whole site (plots, buildings, features,
  // roads, plus the grass and wall around them) scaled to fit the map area
  // with nothing cropped, and padded so the overlays stay clear of it: the zoom
  // buttons on the right, and on a phone the Media/About bar along the bottom.
  // The frame has the same shape as the map area, so the viewBox centre is the
  // centre of the FREE area, not of the whole box. Until the size is known it
  // is just the site's bounds.
  const [mapSize, setMapSize] = useState<{ w: number; h: number } | null>(null);
  const box = useMemo(() => {
    const xs: number[] = [];
    const ys: number[] = [];
    const add = (pts: { x: number; y: number }[]) => pts.forEach((p) => { xs.push(p.x * VB); ys.push(p.y * vbHeight); });
    for (const u of plots) add(u.polygon_points);
    for (const b of buildings) add(b.polygon_points);
    for (const f of features) add(f.polygon_points);
    for (const r of roads) add(r.path_points);
    if (xs.length === 0) return { x: 0, y: 0, w: VB, h: vbHeight };
    // grass border (0.05 * VB) + trees and wall, with a little to spare
    const margin = VB * 0.05 + 16;
    let x0 = Math.min(...xs) - margin;
    let y0 = Math.min(...ys) - margin;
    let x1 = Math.max(...xs) + margin;
    let y1 = Math.max(...ys) + margin;
    // The gate's approach road reaches out past the wall: keep it in frame.
    if (scene.gate) {
      const g = scene.gate;
      x0 = Math.min(x0, g.endX - g.width / 2 - 10);
      x1 = Math.max(x1, g.endX + g.width / 2 + 10);
      y0 = Math.min(y0, g.endY - g.width / 2 - 10);
      y1 = Math.max(y1, g.endY + g.width / 2 + 10);
    }
    const cx0 = x0;
    const cy0 = y0;
    const cw = x1 - x0;
    const ch = y1 - y0;
    if (!mapSize || mapSize.w < 50 || mapSize.h < 50) return { x: cx0, y: cy0, w: cw, h: ch };
    // The overlays: a column of compass and zoom buttons (44px wide, 12px from
    // the right edge) and, on a phone, the Media/About bar along the bottom
    // (about 72px tall). Reserving a strip down the right and a band along the
    // bottom of a phone keeps the site clear of both, and costs less map than
    // reserving the column's full height would.
    const padL = 8;
    const padT = 8;
    // On a wide window the site is height-limited and never reaches the side
    // strip, so reserve it only on narrower screens (this keeps the site centred).
    const padR = mapSize.w >= 900 ? 8 : 8 + 52;
    // Media/About bar: taller reserve on a phone (unchanged), a smaller one on desktop.
    const padB = mapSize.w < 640 ? 8 + 80 : 8 + 64;
    const s = Math.min((mapSize.w - padL - padR) / cw, (mapSize.h - padT - padB) / ch);
    const freeCx = (padL + mapSize.w - padR) / 2;
    const freeCy = (padT + mapSize.h - padB) / 2;
    return { x: cx0 + cw / 2 - freeCx / s, y: cy0 + ch / 2 - freeCy / s, w: mapSize.w / s, h: mapSize.h / s };
  }, [plots, buildings, features, roads, vbHeight, mapSize, scene.gate]);

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

  // Mouse wheel and trackpad pinch zoom toward the cursor. A native listener
  // (not React's onWheel) because React registers wheel handlers as passive,
  // and a passive handler cannot stop the browser from zooming or scrolling
  // the whole page. A trackpad pinch arrives as a wheel event with ctrlKey set
  // and small deltas, so the zoom is proportional to the delta instead of one
  // fixed step per event: a mouse notch (about 100) gives roughly 1.17x, a
  // pinch zooms smoothly.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || zoomedId) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const group = panGroupRef.current;
      if (!group) return;
      // A viewBoxSize of 1 makes clientPointToLocalFraction hand back raw
      // local SVG units (no division) rather than a 0..1 fraction: x and y no
      // longer share one unit scale (VB vs vbHeight).
      const rawLocal = clientPointToLocalFraction(group, e.clientX, e.clientY, 1);
      if (!rawLocal) return;
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      const factor = Math.min(1.35, Math.max(1 / 1.35, Math.exp(-dy * (e.ctrlKey ? 0.012 : 0.0016))));
      setView((prev) => {
        const nextScale = Math.min(MAX_FREE_ZOOM, Math.max(1, prev.scale * factor));
        // Keep the point under the cursor fixed on screen while zooming.
        const px = rawLocal.x;
        const py = rawLocal.y;
        const tx = px - ((px - prev.tx) / prev.scale) * nextScale;
        const ty = py - ((py - prev.ty) / prev.scale) * nextScale;
        return { tx, ty, scale: nextScale };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [zoomedId]);

  // Keyboard: + / = zoom in, - zoom out, 0 fit the whole site, Esc leaves a
  // zoomed-in plot. Ignored while typing in a field or with a modifier held
  // (so browser shortcuts like Ctrl+0 keep working).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (zoomedId) {
        if (e.key === "Escape") setZoomedId(null);
        return;
      }
      const zoom = (factor: number) =>
        setView((prev) => {
          const nextScale = Math.min(MAX_FREE_ZOOM, Math.max(1, prev.scale * factor));
          const cx = box.x + box.w / 2;
          const cy = box.y + box.h / 2;
          return { tx: cx - ((cx - prev.tx) / prev.scale) * nextScale, ty: cy - ((cy - prev.ty) / prev.scale) * nextScale, scale: nextScale };
        });
      if (e.key === "+" || e.key === "=") zoom(1.3);
      else if (e.key === "-" || e.key === "_") zoom(1 / 1.3);
      else if (e.key === "0") setView({ tx: 0, ty: 0, scale: 1 });
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomedId, box]);

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
    // Copied out BEFORE the state update: React runs the updater function
    // later, and by then pointer-up may already have cleared panState — which
    // crashed the whole page ("Cannot read properties of null (reading
    // 'origTx')") whenever a drag ended quickly. Confirmed from the
    // production crash log, not guessed.
    const { origTx, origTy } = panState.current;
    setView((prev) => ({ ...prev, tx: origTx + dx, ty: origTy + dy }));
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
      const centerX = box.x + box.w / 2;
      const centerY = box.y + box.h / 2;
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
    const fitScale = Math.min(box.w / paddedWidth, box.h / paddedHeight);
    const scale = Math.min(MAX_FREE_ZOOM, Math.max(ZONE_MIN_ZOOM, fitScale));
    const targetX = box.x + box.w / 2;
    const targetY = box.y + box.h / 2;
    const tx = targetX - scale * centerX;
    const ty = targetY - scale * centerY;
    return `translate(${tx}px, ${ty}px) scale(${scale})`;
  }, [highlightZoneBounds, box]);

  const transform = useMemo(() => {
    // A zoomed-in plot/building always wins over a zone fly-in — this is
    // exactly the "click Building/Plot" step of the Site → Zone → Building
    // flow, and this branch is completely unchanged from before zone
    // fly-in existed, so that existing Building → Floor → Flat behavior
    // stays untouched.
    if (zoomedShapePoints && zoomedShapePoints.length >= 3) {
      const center = scaledBoundingBoxCenter(zoomedShapePoints, VB, vbHeight);
      const targetX = box.x + box.w / 2;
      const targetY = box.y + box.h / 2;
      // Combined translate+scale so the zoomed shape's center lands in the
      // middle of the viewBox: translate(A - s*C) scale(s) applied to a
      // point p gives s*p + (A - s*C) = s*(p - C) + A, i.e. C maps to A.
      const tx = targetX - ZOOM_SCALE * center.x;
      const ty = targetY - ZOOM_SCALE * center.y;
      return `translate(${tx}px, ${ty}px) scale(${ZOOM_SCALE})`;
    }
    if (zoneTransform) return zoneTransform;
    return "translate(0px, 0px) scale(1)";
  }, [zoomedShapePoints, vbHeight, zoneTransform, box]);

  // Screen pixels per map unit, including free-roam zoom and the scripted
  // zoom into a plot/zone. Written to the SVG as the CSS variable --k so the
  // constant-size labels can scale themselves (see the labels layer in
  // MapShapes). Only a style property changes — nothing re-renders.
  const svgRef = useRef<SVGSVGElement>(null);
  const pxPerUnit = useRef(0.4);
  const scriptedScale = useMemo(() => Number(/scale\(([\d.]+)\)/.exec(transform)?.[1] ?? 1), [transform]);
  const applyK = useCallback(() => {
    svgRef.current?.style.setProperty("--k", String(pxPerUnit.current * view.scale * scriptedScale));
  }, [view.scale, scriptedScale]);
  useLayoutEffect(() => {
    applyK();
  }, [applyK]);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const r = svg.getBoundingClientRect();
      pxPerUnit.current = Math.min(r.width / box.w, r.height / box.h) || 0.4;
      setMapSize((prev) => (prev && Math.abs(prev.w - r.width) < 0.5 && Math.abs(prev.h - r.height) < 0.5 ? prev : { w: r.width, h: r.height }));
      applyK();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(svg);
    return () => ro.disconnect();
  }, [applyK, box]);

  const ftPerUnit = useMemo(
    () => (calibration ? feetPerUnit(calibration.pointA, calibration.pointB, calibration.realDistanceFt, VB, vbHeight) : null),
    [calibration, vbHeight],
  );

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
          ref={svgRef}
          viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
          className="h-full w-full bg-[#0b1f2e]"
          style={{ cursor: zoomedId ? "default" : "grab", touchAction: zoomedId ? "auto" : "none" }}
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
            {/* The uploaded plan photo itself is deliberately NOT rendered
                here any more — per the user's explicit choice, this is now
                a fully redrawn flat map (clean opaque plot/road/feature
                colors on the plain dark map background below) rather than
                shapes traced semi-transparently over a visible photo. The
                photo's aspect ratio is still what `vbHeight` above is
                derived from (via useImageAspectRatio(planImageUrl)) — only
                the VISUAL image is gone, not the coordinate system every
                traced shape is normalized against. Nothing here reproduces
                decorative elements that only ever existed in the photo
                itself (a developer's logo, a legend/distance-meter box, a
                tree-border) — this redraws exactly what's been traced or
                detected (plots/roads/features), which is the only data
                this app actually has. */}

            <MapShapes
              roads={roads}
              scene={scene}
              projectName={projectName}
              plots={plots}
              buildings={buildings}
              features={features}
              vbHeight={vbHeight}
              colorMode={colorMode}
              zones={zones}
              highlightZone={highlightZone}
              highlightStatus={highlightStatus}
              selectedId={zoomedId}
ftPerUnit={ftPerUnit}
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
          {(hoveredUnit.unit.dimensions || hoveredUnit.unit.area_sqft) && (
            <span className="ml-1.5 text-white/80">
              {hoveredUnit.unit.dimensions ?? `${Math.round(hoveredUnit.unit.area_sqft ?? 0).toLocaleString("en-IN")} sqft`}
            </span>
          )}
          <span className="ml-1.5 text-white/60">{UNIT_STATUS_STYLES[hoveredUnit.unit.status].label}</span>
        </div>
      )}

      {!zoomedId && (
        <div className="absolute bottom-3 right-3 z-10 flex flex-col gap-1.5">
          <Compass inline angleDegrees={calibration?.northAngleDegrees} />
          <button
            type="button"
            onClick={() => zoomBy(1.3)}
            aria-label="Zoom in"
            className="flex h-11 w-11 items-center justify-center rounded-md bg-white/90 text-lg font-semibold text-[#0f2436] shadow hover:bg-white sm:h-8 sm:w-8 sm:text-base"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => zoomBy(1 / 1.3)}
            aria-label="Zoom out"
            className="flex h-11 w-11 items-center justify-center rounded-md bg-white/90 text-lg font-semibold text-[#0f2436] shadow hover:bg-white sm:h-8 sm:w-8 sm:text-base"
          >
            −
          </button>
          <button
            type="button"
            onClick={resetView}
            aria-label="Fit to view"
            className="flex h-11 items-center justify-center rounded-md bg-white/90 px-2 text-xs font-medium text-[#0f2436] shadow hover:bg-white sm:h-8 sm:w-8 sm:px-0 sm:text-[11px]"
          >
            Fit
          </button>
        </div>
      )}
    </div>
  );
}
