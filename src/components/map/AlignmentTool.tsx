"use client";

// Interactive 2-point alignment tool: the sub-admin clicks one recognisable
// spot on the plan image and then the same spot on the satellite map (done
// twice). Those four clicks determine the SatelliteAlignment stored in
// project.map_bounds — a similarity transform (scale + rotation + translate)
// that projects every fractional polygon onto real lat/lng.
//
// Shortcuts:
//  - Paste Google Maps coordinates ("lat, lng") to fly the satellite directly.
//  - If the project already has a calibration with north angle, pasting one
//    coordinate auto-computes the full alignment (plan centre → pasted point,
//    second point derived from scale + north direction).
//
// Manual UI flow (four sequential steps):
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
import type { MapCalibration, SatelliteAlignment, Unit, PolygonPoint } from "@/lib/types";

interface Props {
  projectId: string;
  planImageUrl: string;
  plots: Unit[];
  existingAlignment: SatelliteAlignment | null;
  calibration: MapCalibration | null;
  imageWidth: number | null;
  imageHeight: number | null;
}

type Step = 1 | 2 | 3 | 4;

const STEP_LABELS: Record<Step, string> = {
  1: "Step 1 of 4 — click a recognisable spot on the plan",
  2: "Step 2 of 4 — click the same spot on the satellite map",
  3: "Step 3 of 4 — click a second recognisable spot on the plan",
  4: "Step 4 of 4 — click the same spot on the satellite map",
};

// Feet per degree of latitude (fixed) and longitude (depends on lat).
const FT_PER_DEG_LAT = 364320;

// Given calibration + one geo reference point (at plan centre 0.5, 0.5),
// compute a full SatelliteAlignment. The second alignment point is placed
// 0.2 plan-units to the right of centre, with its geo position derived from
// the calibration scale and the plan's north angle.
function autoAlignFromCalibration(
  lat: number,
  lng: number,
  cal: MapCalibration,
  imgW: number,
  imgH: number,
): SatelliteAlignment {
  const plan1: PolygonPoint = { x: 0.5, y: 0.5 };
  const geo1 = { lat, lng };
  const plan2: PolygonPoint = { x: 0.7, y: 0.5 };

  // Scaled calibration points (same convention as calibration.ts feetPerUnit)
  const axS = cal.pointA.x * imgW;
  const ayS = cal.pointA.y * imgH;
  const bxS = cal.pointB.x * imgW;
  const byS = cal.pointB.y * imgH;
  const calDist = Math.hypot(bxS - axS, byS - ayS);
  const fpu = calDist > 0 ? cal.realDistanceFt / calDist : 0;
  if (fpu <= 0) return { plan1, geo1, plan2, geo2: { lat: lat + 0.001, lng } };

  // Real-world distance from plan1 to plan2 (0.2 * imgW scaled units)
  const planDistScaled = 0.2 * imgW;
  const realDistFt = planDistScaled * fpu;

  // Bearing for plan's "right" direction in true north terms.
  // northAngleDegrees is 0 = plan-up is north, increasing clockwise.
  // Plan right = 90° clockwise from north = northAngleDegrees + 90.
  const northDeg = cal.northAngleDegrees ?? 0;
  const bearingDeg = (northDeg + 90 + 360) % 360;
  const bearingRad = (bearingDeg * Math.PI) / 180;
  const ftPerDegLng = FT_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);

  const geo2 = {
    lat: lat + (realDistFt * Math.cos(bearingRad)) / FT_PER_DEG_LAT,
    lng: lng + (realDistFt * Math.sin(bearingRad)) / ftPerDegLng,
  };
  return { plan1, geo1, plan2, geo2 };
}

export function AlignmentTool({ projectId, planImageUrl, plots, existingAlignment, calibration, imageWidth, imageHeight }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [planPt1, setPlanPt1] = useState<PolygonPoint | null>(existingAlignment?.plan1 ?? null);
  const [planPt2, setPlanPt2] = useState<PolygonPoint | null>(existingAlignment?.plan2 ?? null);
  const [geoPt1, setGeoPt1] = useState<{ lat: number; lng: number } | null>(existingAlignment?.geo1 ?? null);
  const [geoPt2, setGeoPt2] = useState<{ lat: number; lng: number } | null>(existingAlignment?.geo2 ?? null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);
  const [coordInput, setCoordInput] = useState("");
  const [coordError, setCoordError] = useState<string | null>(null);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  const planImgRef = useRef<HTMLImageElement>(null);
  // Indirection so the map's click handler always calls the latest version
  // of handleSatClick without needing to re-register the map listener.
  const satClickRef = useRef<(lat: number, lng: number) => void>(() => {});

  const alignment = useMemo<SatelliteAlignment | null>(
    () =>
      planPt1 && planPt2 && geoPt1 && geoPt2
        ? { plan1: planPt1, geo1: geoPt1, plan2: planPt2, geo2: geoPt2 }
        : null,
    [planPt1, planPt2, geoPt1, geoPt2],
  );

  const canAutoAlign = calibration !== null && imageWidth !== null && imageHeight !== null;

  // Initialise MapLibre once on mount
  useEffect(() => {
    if (!mapContainerRef.current) return;
    import("maplibre-gl").then((mod) => {
      if (!mapContainerRef.current || mapRef.current) return;
      const center: [number, number] = existingAlignment
        ? [existingAlignment.geo1.lng, existingAlignment.geo1.lat]
        : [78.9629, 20.5937];
      const zoom = existingAlignment ? 17 : 5;
      const map = new mod.Map({
        container: mapContainerRef.current,
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

  // The click handler reads step via a ref to avoid stale closures
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

  // Parse "lat, lng" from Google Maps paste; return null on error.
  function parseCoords(raw: string): { lat: number; lng: number } | null {
    const parts = raw.split(",").map((s) => s.trim());
    if (parts.length !== 2) return null;
    const lat = parseFloat(parts[0]);
    const lng = parseFloat(parts[1]);
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng };
  }

  function flyTo(lat: number, lng: number) {
    mapRef.current?.flyTo({ center: [lng, lat], zoom: 17, duration: 1200 });
  }

  function handleCoordGo() {
    setCoordError(null);
    const parsed = parseCoords(coordInput);
    if (!parsed) { setCoordError("Paste as: 28.6139, 77.2090"); return; }
    flyTo(parsed.lat, parsed.lng);
  }

  function handleAutoAlign() {
    setCoordError(null);
    const parsed = parseCoords(coordInput);
    if (!parsed) { setCoordError("Paste as: 28.6139, 77.2090"); return; }
    if (!calibration || !imageWidth || !imageHeight) return;
    const a = autoAlignFromCalibration(parsed.lat, parsed.lng, calibration, imageWidth, imageHeight);
    setPlanPt1(a.plan1); setGeoPt1(a.geo1);
    setPlanPt2(a.plan2); setGeoPt2(a.geo2);
    flyTo(parsed.lat, parsed.lng);
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

  return (
    <div className="flex flex-col gap-4">
      {/* Coordinate paste row */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-white/50">Google Maps coordinates (lat, lng)</label>
          <input
            type="text"
            value={coordInput}
            onChange={(e) => setCoordInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleCoordGo(); }}
            placeholder="28.6139, 77.2090"
            className="w-52 rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-sm text-white placeholder-white/30 focus:border-blue-500/60 focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={handleCoordGo}
          className="rounded-lg border border-white/20 px-3 py-1.5 text-sm text-white/70 hover:text-white transition-colors"
        >
          Fly to
        </button>
        {canAutoAlign && (
          <button
            type="button"
            onClick={handleAutoAlign}
            className="rounded-lg bg-blue-600/80 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
            title="Uses the project's scale and north direction to place the plan automatically"
          >
            Auto-place
          </button>
        )}
        {coordError && <p className="text-xs text-red-400">{coordError}</p>}
      </div>

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
            {planPt1 && <Crosshair x={planPt1.x} y={planPt1.y} label="1" color="#3b82f6" />}
            {planPt2 && <Crosshair x={planPt2.x} y={planPt2.y} label="2" color="#f59e0b" />}
          </div>
        </div>

        {/* Satellite panel */}
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-white/60">Satellite</p>
          <div className="relative overflow-hidden rounded-xl border border-white/10" style={{ height: 400 }}>
            <div ref={mapContainerRef} className="absolute inset-0" />
            <div className="pointer-events-none absolute bottom-8 right-2 flex flex-col gap-1">
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

function Crosshair({ x, y, label, color }: { x: number; y: number; label: string; color: string }) {
  return (
    <div
      className="pointer-events-none absolute"
      style={{ left: `${x * 100}%`, top: `${y * 100}%`, transform: "translate(-50%, -50%)" }}
    >
      <div className="relative flex items-center justify-center">
        <div className="absolute h-px w-6" style={{ backgroundColor: color }} />
        <div className="absolute w-px h-6" style={{ backgroundColor: color }} />
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

function buildGeoJSON(plots: Unit[], alignment: SatelliteAlignment) {
  const features = plots
    .filter((u) => u.polygon_points.length >= 3)
    .map((u) => {
      const latlngs = projectPolygon(u.polygon_points, alignment);
      const coords = [...latlngs.map((p) => [p.lng, p.lat]), [latlngs[0].lng, latlngs[0].lat]];
      const style = UNIT_STATUS_STYLES[u.status];
      return {
        type: "Feature" as const,
        properties: { label: u.unit_number, fillColor: style.fill, strokeColor: style.border },
        geometry: { type: "Polygon" as const, coordinates: [coords] },
      };
    });
  return { type: "FeatureCollection" as const, features };
}
