"use client";

// Interactive 2-point alignment tool: the sub-admin clicks one recognisable
// spot on the plan image and then the same spot on the satellite map (done
// twice). Those four clicks determine the SatelliteAlignment stored in
// project.map_bounds — a similarity transform (scale + rotation + translate)
// that projects every fractional polygon onto real lat/lng.
//
// UI flow (four sequential steps):
//  1. Click on plan  → planPt1 set
//  2. Click on sat   → geoPt1 set
//  3. Click on plan  → planPt2 set
//  4. Click on sat   → geoPt2 set
//  → preview rendered (plots as coloured polygons on satellite), Save enabled.
//
// MapLibre is imported dynamically inside a useEffect so it never runs on
// the server (it needs the DOM and WebGL).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { projectPolygon } from "@/lib/map/geo";
import { saveSatelliteAlignment } from "@/lib/actions/projects";
import { ESRI_TILE_URL, ESRI_ATTRIBUTION } from "@/lib/satellite";
import { UNIT_STATUS_STYLES } from "@/lib/types";
import type { SatelliteAlignment, Unit } from "@/lib/types";
import type { PolygonPoint } from "@/lib/types";

interface Props {
  projectId: string;
  planImageUrl: string;
  plots: Unit[];
  existingAlignment: SatelliteAlignment | null;
}

type Step = 1 | 2 | 3 | 4;

const STEP_LABELS: Record<Step, string> = {
  1: "Step 1 of 4 — click a recognisable spot on the plan",
  2: "Step 2 of 4 — click the same spot on the satellite map",
  3: "Step 3 of 4 — click a second recognisable spot on the plan",
  4: "Step 4 of 4 — click the same spot on the satellite map",
};

export function AlignmentTool({ projectId, planImageUrl, plots, existingAlignment }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [planPt1, setPlanPt1] = useState<PolygonPoint | null>(existingAlignment?.plan1 ?? null);
  const [planPt2, setPlanPt2] = useState<PolygonPoint | null>(existingAlignment?.plan2 ?? null);
  const [geoPt1, setGeoPt1] = useState<{ lat: number; lng: number } | null>(existingAlignment?.geo1 ?? null);
  const [geoPt2, setGeoPt2] = useState<{ lat: number; lng: number } | null>(existingAlignment?.geo2 ?? null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const maplibreRef = useRef<any>(null);
  const planImgRef = useRef<HTMLImageElement>(null);
  // Indirection so the map's click handler always calls the latest version
  // of handleSatClick without needing to re-register the map listener.
  const satClickRef = useRef<(lat: number, lng: number) => void>(() => {});

  // Memoised so the preview useEffect doesn't re-run on every render.
  const alignment = useMemo<SatelliteAlignment | null>(
    () =>
      planPt1 && planPt2 && geoPt1 && geoPt2
        ? { plan1: planPt1, geo1: geoPt1, plan2: planPt2, geo2: geoPt2 }
        : null,
    [planPt1, planPt2, geoPt1, geoPt2],
  );

  // Initialise MapLibre once on mount
  useEffect(() => {
    if (!mapContainerRef.current) return;
    let map: ReturnType<typeof mapRef.current>;
    import("maplibre-gl").then((mod) => {
      // maplibre-gl v6 ships ESM — Map is a named export, not default.
      const maplibregl = mod;
      maplibreRef.current = maplibregl;
      // Default to India; user will navigate to their site
      const center: [number, number] = existingAlignment
        ? [existingAlignment.geo1.lng, existingAlignment.geo1.lat]
        : [78.9629, 20.5937];
      const zoom = existingAlignment ? 17 : 5;
      map = new maplibregl.Map({
        container: mapContainerRef.current!,
        style: {
          version: 8,
          sources: {
            esri: {
              type: "raster",
              tiles: [ESRI_TILE_URL],
              tileSize: 256,
              attribution: ESRI_ATTRIBUTION,
            },
          },
          layers: [{ id: "esri-layer", type: "raster", source: "esri" }],
        },
        center,
        zoom,
        attributionControl: { compact: false },
      });
      mapRef.current = map;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map.on("click", (e: any) => satClickRef.current(e.lngLat.lat, e.lngLat.lng));
    });
    return () => {
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on mount
  }, []);

  // Update preview layer whenever alignment is ready
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !alignment) return;
    // Wait for map to be loaded before touching sources
    const addOrUpdate = () => {
      const geojson = buildGeoJSON(plots, alignment);
      if (map.getSource("plots-preview")) {
        map.getSource("plots-preview").setData(geojson);
      } else {
        map.addSource("plots-preview", { type: "geojson", data: geojson });
        map.addLayer({
          id: "plots-fill",
          type: "fill",
          source: "plots-preview",
          paint: { "fill-color": ["get", "fillColor"], "fill-opacity": 0.35 },
        });
        map.addLayer({
          id: "plots-outline",
          type: "line",
          source: "plots-preview",
          paint: { "line-color": ["get", "strokeColor"], "line-width": 1.5 },
        });
        map.addLayer({
          id: "plots-label",
          type: "symbol",
          source: "plots-preview",
          layout: { "text-field": ["get", "label"], "text-size": 10, "symbol-placement": "point" },
          paint: { "text-color": "#ffffff", "text-halo-color": "#000000", "text-halo-width": 1 },
        });
      }
    };
    if (map.loaded()) addOrUpdate();
    else map.once("load", addOrUpdate);
  }, [alignment, plots]);

  // The click handler needs fresh step/state — use a ref to avoid stale closure
  const stepRef = useRef(step);
  useEffect(() => { stepRef.current = step; }, [step]);

  const handleSatClick = useCallback((lat: number, lng: number) => {
    if (stepRef.current === 2) { setGeoPt1({ lat, lng }); setStep(3); }
    else if (stepRef.current === 4) { setGeoPt2({ lat, lng }); setStep(1); }
  }, []);
  useEffect(() => { satClickRef.current = handleSatClick; }, [handleSatClick]);

  function handlePlanClick(e: React.MouseEvent<HTMLImageElement>) {
    const img = planImgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (step === 1) { setPlanPt1({ x, y }); setStep(2); }
    else if (step === 3) { setPlanPt2({ x, y }); setStep(4); }
  }

  function reset() {
    setPlanPt1(null); setPlanPt2(null); setGeoPt1(null); setGeoPt2(null);
    setSavedOk(false); setSaveError(null); setStep(1);
  }

  async function handleSave() {
    if (!alignment) return;
    setSaving(true); setSaveError(null);
    const result = await saveSatelliteAlignment(projectId, alignment);
    setSaving(false);
    if (result.error) { setSaveError(result.error); return; }
    setSavedOk(true);
  }

  const planClickable = step === 1 || step === 3;
  const satClickable = step === 2 || step === 4;

  return (
    <div className="flex flex-col gap-4">
      {/* Instruction banner */}
      <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-2.5 text-sm text-blue-300">
        {alignment ? "Alignment set — preview below. Save or start over." : STEP_LABELS[step]}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Plan panel */}
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-white/60">Plan image</p>
          <div
            className="relative overflow-hidden rounded-xl border border-white/10 bg-black"
            style={{ cursor: planClickable ? "crosshair" : "default" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={planImgRef}
              src={planImageUrl}
              alt="Site plan"
              className="w-full select-none"
              draggable={false}
              onClick={handlePlanClick}
            />
            {/* Crosshair markers */}
            {planPt1 && <Crosshair x={planPt1.x} y={planPt1.y} label="1" color="#3b82f6" />}
            {planPt2 && <Crosshair x={planPt2.x} y={planPt2.y} label="2" color="#f59e0b" />}
          </div>
        </div>

        {/* Satellite panel */}
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-white/60">Satellite</p>
          <div
            className="relative overflow-hidden rounded-xl border border-white/10"
            style={{ height: 400, cursor: satClickable ? "crosshair" : "" }}
          >
            <div ref={mapContainerRef} className="absolute inset-0" />
            {/* Geo markers (MapLibre markers are hard to layer, so we use
                map.project() — but that needs a re-render on every pan.
                Easier: just show a status badge so the user knows what's set.) */}
            <div className="pointer-events-none absolute bottom-2 right-2 flex flex-col gap-1">
              {geoPt1 && (
                <span className="rounded-full bg-blue-500/80 px-2 py-0.5 text-[10px] font-semibold text-white">
                  Point 1 set
                </span>
              )}
              {geoPt2 && (
                <span className="rounded-full bg-amber-500/80 px-2 py-0.5 text-[10px] font-semibold text-white">
                  Point 2 set
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={!alignment || saving || savedOk}
          className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow disabled:opacity-40 hover:bg-blue-500 active:scale-95 transition-all"
        >
          {saving ? "Saving…" : savedOk ? "Saved ✓" : "Save alignment"}
        </button>
        <button
          type="button"
          onClick={reset}
          className="rounded-lg border border-white/20 px-4 py-2 text-sm text-white/70 hover:text-white transition-colors"
        >
          Start over
        </button>
        {saveError && <p className="text-sm text-red-400">{saveError}</p>}
      </div>
    </div>
  );
}

// Crosshair overlay positioned absolutely over the plan image
function Crosshair({ x, y, label, color }: { x: number; y: number; label: string; color: string }) {
  return (
    <div
      className="pointer-events-none absolute"
      style={{ left: `${x * 100}%`, top: `${y * 100}%`, transform: "translate(-50%, -50%)" }}
    >
      <div className="relative flex items-center justify-center">
        {/* Horizontal line */}
        <div className="absolute h-px w-6" style={{ backgroundColor: color }} />
        {/* Vertical line */}
        <div className="absolute w-px h-6" style={{ backgroundColor: color }} />
        {/* Label badge */}
        <div
          className="absolute -top-4 left-2 rounded px-1 text-[10px] font-bold text-white"
          style={{ backgroundColor: color }}
        >
          {label}
        </div>
      </div>
    </div>
  );
}

// Build a GeoJSON FeatureCollection of plot polygons projected onto lat/lng
function buildGeoJSON(plots: Unit[], alignment: SatelliteAlignment) {
  const features = plots
    .filter((u) => u.polygon_points.length >= 3)
    .map((u) => {
      const latlngs = projectPolygon(u.polygon_points, alignment);
      const coords = [...latlngs.map((p) => [p.lng, p.lat]), [latlngs[0].lng, latlngs[0].lat]];
      const style = UNIT_STATUS_STYLES[u.status];
      return {
        type: "Feature" as const,
        properties: {
          label: u.unit_number,
          fillColor: style.fill,
          strokeColor: style.border,
        },
        geometry: { type: "Polygon" as const, coordinates: [coords] },
      };
    });
  return { type: "FeatureCollection" as const, features };
}
