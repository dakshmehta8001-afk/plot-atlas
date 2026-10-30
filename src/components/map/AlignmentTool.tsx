"use client";

// Placeholder shell — replaced in the next commit with the drag/rotate/resize
// version. This file just needs to compile after the SatelliteAlignment type
// changed from the old 2-point format to center/northAngle/mppX/mppY.
import { useEffect, useRef } from "react";
import { saveSatelliteAlignment } from "@/lib/actions/projects";
import { ESRI_TILE_URL, ESRI_ATTRIBUTION } from "@/lib/satellite";
import type { MapCalibration, SatelliteAlignment, Unit } from "@/lib/types";

interface Props {
  projectId: string;
  planImageUrl: string;
  plots: Unit[];
  existingAlignment: SatelliteAlignment | null;
  calibration: MapCalibration | null;
  imageWidth: number | null;
  imageHeight: number | null;
}

export function AlignmentTool({ projectId, planImageUrl, existingAlignment }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mlRef = useRef<any>(null);

  useEffect(() => {
    if (!mapRef.current) return;
    import("maplibre-gl").then((mod) => {
      if (!mapRef.current || mlRef.current) return;
      const center: [number, number] = existingAlignment
        ? [existingAlignment.center.lng, existingAlignment.center.lat]
        : [78.9629, 20.5937];
      mlRef.current = new mod.Map({
        container: mapRef.current,
        style: {
          version: 8,
          sources: { esri: { type: "raster", tiles: [ESRI_TILE_URL], tileSize: 256, attribution: ESRI_ATTRIBUTION } },
          layers: [{ id: "esri", type: "raster", source: "esri" }],
        },
        center,
        zoom: existingAlignment ? 17 : 5,
        attributionControl: { compact: false },
      });
    });
    return () => { if (mlRef.current) { mlRef.current.remove(); mlRef.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave() {
    if (!existingAlignment) return;
    await saveSatelliteAlignment(projectId, existingAlignment);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-amber-400">Alignment editor loading — full version in next commit.</p>
      <div className="text-xs text-white/40">Plan: {planImageUrl.slice(0, 60)}…</div>
      <div ref={mapRef} className="h-64 rounded-xl border border-white/10" />
      <button type="button" onClick={handleSave} disabled={!existingAlignment} className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-40">Save</button>
    </div>
  );
}
