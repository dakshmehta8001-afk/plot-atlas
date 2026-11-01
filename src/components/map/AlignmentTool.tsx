"use client";

// Satellite alignment editor. The plan image is rendered as a semi-transparent
// MapLibre image layer. The sub-admin can:
//  - Paste a Google Maps link (including short links) → server resolves it to
//    lat/lng, then auto-place fills in the rest from the project calibration.
//  - Drag the plan body to reposition.
//  - Drag the north handle (top edge midpoint) to rotate.
//  - Drag the scale handle (bottom-right corner) to resize.
//  - Fall back to a raw lat/lng paste if the link can't be resolved.
//  - Save via the saveSatelliteAlignment server action.
import { useCallback, useEffect, useRef, useState } from "react";
import { computeCorners, projectPoint, unprojectPoint, autoAlignFromCalibration } from "@/lib/map/geo";
import { saveSatelliteAlignment } from "@/lib/actions/projects";
import { resolveGoogleMapsCoords } from "@/lib/actions/satellite";
import { ESRI_TILE_URL, ESRI_ATTRIBUTION } from "@/lib/satellite";
import type { MapCalibration, SatelliteAlignment, Unit } from "@/lib/types";
import { configureMaplibreWorker } from "@/lib/map/maplibreWorker";

interface Props {
  projectId: string;
  planImageUrl: string;
  plots: Unit[];
  existingAlignment: SatelliteAlignment | null;
  calibration: MapCalibration | null;
  imageWidth: number | null;
  imageHeight: number | null;
  /** Project location field — used as the initial Maps link if it looks like a URL. */
  projectLocation: string | null;
}

// Which handle is being dragged
type DragTarget = "body" | "north" | "scale" | null;

const HANDLE_PX = 14; // hit-target radius for HTML handles

export function AlignmentTool({
  projectId, planImageUrl, plots, existingAlignment,
  calibration, imageWidth, imageHeight, projectLocation,
}: Props) {
  const canAutoAlign = calibration !== null && imageWidth !== null && imageHeight !== null;

  // Alignment state — mutable during drag
  const [alignment, setAlignment] = useState<SatelliteAlignment | null>(existingAlignment);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);
  const [linkInput, setLinkInput] = useState(
    projectLocation?.startsWith("http") ? projectLocation : "",
  );
  const [linkError, setLinkError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  // Handle screen positions — updated on every map move/zoom
  const [handles, setHandles] = useState<{ center: [number, number]; north: [number, number]; scale: [number, number] } | null>(null);

  // MapLibre refs
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  const alignRef = useRef(alignment);
  useEffect(() => { alignRef.current = alignment; }, [alignment]);

  // Drag state
  const dragRef = useRef<{ target: DragTarget; startPx: [number, number]; startAlign: SatelliteAlignment } | null>(null);

  // Initialise MapLibre once
  useEffect(() => {
    if (!containerRef.current) return;
    import("maplibre-gl").then((mod) => {
      configureMaplibreWorker(mod);
      if (!containerRef.current || mapRef.current) return;
      const a = alignRef.current;
      const map = new mod.Map({
        container: containerRef.current,
        style: {
          version: 8,
          sources: { esri: { type: "raster", tiles: [ESRI_TILE_URL], tileSize: 256, attribution: ESRI_ATTRIBUTION } },
          layers: [{ id: "esri", type: "raster", source: "esri" }],
        },
        center: a ? [a.center.lng, a.center.lat] : [78.9629, 20.5937],
        zoom: a ? 17 : 5,
        attributionControl: { compact: false },
      });
      mapRef.current = map;

      map.on("load", () => {
        if (!alignRef.current) return;
        addPlanLayer(map, planImageUrl, alignRef.current);
        updateHandles(map, alignRef.current);
      });

      map.on("move", () => {
        if (alignRef.current) updateHandles(map, alignRef.current);
      });
    });
    return () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on mount
  }, []);

  // Sync plan image layer whenever alignment changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.loaded()) return;
    if (!alignment) { if (map.getSource("plan")) { map.removeLayer("plan-layer"); map.removeSource("plan"); } return; }
    if (map.getSource("plan")) {
      map.getSource("plan").setCoordinates(computeCorners(alignment));
    } else {
      addPlanLayer(map, planImageUrl, alignment);
    }
    updateHandles(map, alignment);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alignment]);

  function addPlanLayer(map: unknown, url: string, a: SatelliteAlignment) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = map as any;
    m.addSource("plan", { type: "image", url, coordinates: computeCorners(a) });
    m.addLayer({ id: "plan-layer", type: "raster", source: "plan", paint: { "raster-opacity": 0.85 } });
  }

  function updateHandles(map: unknown, a: SatelliteAlignment) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = map as any;
    const centerGeo = a.center;
    const northGeo = projectPoint({ x: 0.5, y: 0.05 }, a); // slightly inset from top edge
    const scaleGeo = projectPoint({ x: 0.95, y: 0.95 }, a); // slightly inset from bottom-right
    const cPx = m.project([centerGeo.lng, centerGeo.lat]);
    const nPx = m.project([northGeo.lng, northGeo.lat]);
    const sPx = m.project([scaleGeo.lng, scaleGeo.lat]);
    setHandles({
      center: [cPx.x, cPx.y],
      north: [nPx.x, nPx.y],
      scale: [sPx.x, sPx.y],
    });
  }

  // --- Pointer drag on the plan / handles ---
  const onPointerDown = useCallback((e: React.PointerEvent, target: DragTarget) => {
    e.preventDefault();
    e.stopPropagation();
    const a = alignRef.current;
    if (!a) return;
    dragRef.current = {
      target,
      startPx: [e.clientX, e.clientY],
      startAlign: { ...a },
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    // Disable MapLibre pan while dragging a handle
    mapRef.current?.dragPan.disable();
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    const map = mapRef.current;
    if (!drag || !map) return;
    const a = drag.startAlign;
    const dx = e.clientX - drag.startPx[0];
    const dy = e.clientY - drag.startPx[1];

    if (drag.target === "body") {
      // Convert screen delta to geo delta using map.unproject
      const orig = map.unproject(drag.startPx);
      const moved = map.unproject([drag.startPx[0] + dx, drag.startPx[1] + dy]);
      setAlignment({
        ...a,
        center: { lat: a.center.lat + (moved.lat - orig.lat), lng: a.center.lng + (moved.lng - orig.lng) },
      });
    } else if (drag.target === "north") {
      // Rotation: angle from center handle to north handle changes
      const cPx = map.project([a.center.lng, a.center.lat]);
      const origAngleRad = Math.atan2(handles!.north[1] - cPx.y, handles!.north[0] - cPx.x);
      const newAngleRad = Math.atan2(handles!.north[1] + dy - cPx.y, handles!.north[0] + dx - cPx.x);
      const deltaDeg = ((newAngleRad - origAngleRad) * 180) / Math.PI;
      setAlignment({ ...a, northAngle: (a.northAngle + deltaDeg + 360) % 360 });
    } else if (drag.target === "scale") {
      // Scale: distance from center to scale handle grows/shrinks proportionally
      const cPx = map.project([a.center.lng, a.center.lat]);
      const origDist = Math.hypot(handles!.scale[0] - cPx.x, handles!.scale[1] - cPx.y);
      const newDist = Math.hypot(handles!.scale[0] + dx - cPx.x, handles!.scale[1] + dy - cPx.y);
      const factor = origDist > 0 ? newDist / origDist : 1;
      setAlignment({ ...a, mppX: a.mppX * factor, mppY: a.mppY * factor });
    }
    // suppress unused warning — unprojectPoint kept for future use
    void unprojectPoint;
  }, [handles]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    dragRef.current = null;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    mapRef.current?.dragPan.enable();
  }, []);

  // --- Google Maps link resolve ---
  async function handleResolve() {
    setLinkError(null); setResolving(true);
    try {
      const result = await resolveGoogleMapsCoords(linkInput);
      if (!result) { setLinkError("No coordinates found in that link — try pasting raw lat, lng instead."); return; }
      applyGeoPoint(result.lat, result.lng);
    } catch { setLinkError("Could not reach the link — paste raw lat, lng instead."); }
    finally { setResolving(false); }
  }

  function applyGeoPoint(lat: number, lng: number) {
    if (canAutoAlign) {
      const a = autoAlignFromCalibration(lat, lng, calibration!, imageWidth!, imageHeight!);
      setAlignment(a);
      mapRef.current?.flyTo({ center: [lng, lat], zoom: 17, duration: 1000 });
    } else {
      // Just fly to the location; the sub-admin uses handles to finish
      setAlignment((prev) => prev ? { ...prev, center: { lat, lng } } : {
        center: { lat, lng }, northAngle: 0, mppX: 500, mppY: 400,
      });
      mapRef.current?.flyTo({ center: [lng, lat], zoom: 17, duration: 1000 });
    }
    setSavedOk(false);
  }

  // Also accept a raw "lat, lng" fallback in the same input
  function handleRawCoords() {
    const parts = linkInput.split(",").map((s) => s.trim());
    if (parts.length === 2) {
      const lat = parseFloat(parts[0]); const lng = parseFloat(parts[1]);
      if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        applyGeoPoint(lat, lng); setLinkError(null); return;
      }
    }
    void handleResolve();
  }

  async function handleSave() {
    if (!alignment) return;
    setSaving(true); setSaveError(null);
    const result = await saveSatelliteAlignment(projectId, alignment);
    setSaving(false);
    if (result.error) { setSaveError(result.error); return; }
    setSavedOk(true);
  }

  const panelWidth = containerRef.current?.offsetWidth ?? 0;
  const panelHeight = (containerRef.current?.offsetHeight ?? 0);
  void panelWidth; void panelHeight; void plots; // used by parent, kept in props for future label overlay

  return (
    <div className="flex flex-col gap-4">
      {/* Location input */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1 flex-1 min-w-[260px]">
          <label className="text-xs text-white/50">
            Google Maps link or coordinates (lat, lng)
          </label>
          <input
            type="text"
            value={linkInput}
            onChange={(e) => { setLinkInput(e.target.value); setLinkError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") handleRawCoords(); }}
            placeholder="https://maps.app.goo.gl/… or 28.6139, 77.2090"
            className="rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-sm text-white placeholder-white/30 focus:border-blue-500/60 focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={handleRawCoords}
          disabled={resolving || !linkInput.trim()}
          className="rounded-lg bg-blue-600/80 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40 transition-colors"
        >
          {resolving ? "Resolving…" : canAutoAlign ? "Place" : "Fly to"}
        </button>
        {linkError && <p className="w-full text-xs text-red-400">{linkError}</p>}
        {!canAutoAlign && (
          <p className="w-full text-xs text-white/40">
            Set the project&apos;s scale and north direction first for automatic sizing.
          </p>
        )}
      </div>

      {/* Instruction */}
      {alignment && (
        <p className="text-xs text-white/50">
          Drag the plan to reposition · drag the <span className="text-blue-300 font-medium">blue dot</span> to rotate · drag the <span className="text-amber-300 font-medium">amber dot</span> to resize.
        </p>
      )}

      {/* Map */}
      <div className="relative overflow-hidden rounded-xl border border-white/10" style={{ height: 500 }}>
        <div ref={containerRef} className="absolute inset-0" />

        {/* Drag overlay for the plan body (covers the whole map while a plan exists) */}
        {alignment && (
          <div
            className="absolute inset-0"
            style={{ cursor: "grab", zIndex: 5 }}
            onPointerDown={(e) => onPointerDown(e, "body")}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          />
        )}

        {/* HTML handles positioned via map.project() */}
        {handles && alignment && (
          <>
            {/* Center (informational — not draggable on its own; the body overlay handles drag) */}
            <div
              className="absolute rounded-full bg-white/50 border-2 border-white pointer-events-none"
              style={{ width: HANDLE_PX, height: HANDLE_PX, left: handles.center[0] - HANDLE_PX / 2, top: handles.center[1] - HANDLE_PX / 2, zIndex: 10 }}
            />
            {/* North / rotation handle */}
            <div
              className="absolute rounded-full bg-blue-500 border-2 border-white cursor-crosshair touch-none"
              title="Drag to rotate"
              style={{ width: HANDLE_PX + 4, height: HANDLE_PX + 4, left: handles.north[0] - (HANDLE_PX + 4) / 2, top: handles.north[1] - (HANDLE_PX + 4) / 2, zIndex: 20 }}
              onPointerDown={(e) => onPointerDown(e, "north")}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            />
            {/* Scale handle */}
            <div
              className="absolute rounded-full bg-amber-400 border-2 border-white cursor-nwse-resize touch-none"
              title="Drag to resize"
              style={{ width: HANDLE_PX + 4, height: HANDLE_PX + 4, left: handles.scale[0] - (HANDLE_PX + 4) / 2, top: handles.scale[1] - (HANDLE_PX + 4) / 2, zIndex: 20 }}
              onPointerDown={(e) => onPointerDown(e, "scale")}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            />
          </>
        )}
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
          onClick={() => { setAlignment(null); setSavedOk(false); setSaveError(null); }}
          className="rounded-lg border border-white/20 px-4 py-2 text-sm text-white/70 hover:text-white transition-colors"
        >
          Reset
        </button>
        {saveError && <p className="text-sm text-red-400">{saveError}</p>}
      </div>
    </div>
  );
}
