"use client";

// Public satellite map for a project that has been satellite-aligned
// (project.map_bounds != null). Renders plot polygons as coloured GeoJSON
// layers on Esri World Imagery using MapLibre GL JS. Clicking a plot
// polygon fires onPlotClick so the caller can open the usual UnitInfoCard.
//
// MapLibre is imported dynamically inside useEffect — it needs the DOM and
// WebGL, so it must never run on the server.
import { useEffect, useRef } from "react";
import { projectPolygon } from "@/lib/map/geo";
import { ESRI_TILE_URL, ESRI_ATTRIBUTION } from "@/lib/satellite";
import { UNIT_STATUS_STYLES } from "@/lib/types";
import type { SatelliteAlignment, Unit, UnitStatus } from "@/lib/types";

interface Props {
  alignment: SatelliteAlignment;
  plots: Unit[];
  highlightStatus: UnitStatus | null;
  onPlotClick: (unit: Unit) => void;
}

export function SatelliteView({ alignment, plots, highlightStatus, onPlotClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // Store latest props in refs so the map click handler always has fresh values
  const plotsRef = useRef(plots);
  const onPlotClickRef = useRef(onPlotClick);
  const highlightStatusRef = useRef(highlightStatus);
  useEffect(() => { plotsRef.current = plots; }, [plots]);
  useEffect(() => { onPlotClickRef.current = onPlotClick; }, [onPlotClick]);
  useEffect(() => { highlightStatusRef.current = highlightStatus; }, [highlightStatus]);

  // Initialise map once
  useEffect(() => {
    if (!containerRef.current) return;
    import("maplibre-gl").then((mod) => {
      if (!containerRef.current || mapRef.current) return;
      const center: [number, number] = [alignment.center.lng, alignment.center.lat];
      const map = new mod.Map({
        container: containerRef.current,
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
        zoom: 17,
        attributionControl: { compact: false },
      });
      mapRef.current = map;

      map.on("load", () => {
        const geojson = buildGeoJSON(plotsRef.current, alignment, highlightStatusRef.current);
        map.addSource("plots", { type: "geojson", data: geojson });
        map.addLayer({
          id: "plots-fill",
          type: "fill",
          source: "plots",
          paint: { "fill-color": ["get", "fillColor"], "fill-opacity": 0.4 },
        });
        map.addLayer({
          id: "plots-outline",
          type: "line",
          source: "plots",
          paint: { "line-color": ["get", "strokeColor"], "line-width": 1.5 },
        });
        map.addLayer({
          id: "plots-label",
          type: "symbol",
          source: "plots",
          layout: {
            "text-field": ["get", "label"],
            "text-size": 10,
            "symbol-placement": "point",
            "text-allow-overlap": true,
          },
          paint: { "text-color": "#ffffff", "text-halo-color": "#000000", "text-halo-width": 1.5 },
        });

        // Click: find which unit was tapped and call onPlotClick
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        map.on("click", "plots-fill", (e: any) => {
          const unitId = e.features?.[0]?.properties?.unitId as string | undefined;
          if (!unitId) return;
          const unit = plotsRef.current.find((u) => u.id === unitId);
          if (unit) onPlotClickRef.current(unit);
        });
        map.on("mouseenter", "plots-fill", () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", "plots-fill", () => { map.getCanvas().style.cursor = ""; });
      });
    });
    return () => {
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- alignment is stable; re-init only on mount
  }, []);

  // Update layer data whenever plots or filter changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.loaded()) return;
    const src = map.getSource("plots");
    if (src) src.setData(buildGeoJSON(plots, alignment, highlightStatus));
  }, [plots, alignment, highlightStatus]);

  return <div ref={containerRef} className="absolute inset-0" />;
}

function buildGeoJSON(plots: Unit[], alignment: SatelliteAlignment, highlightStatus: UnitStatus | null) {
  const features = plots
    .filter((u) => u.polygon_points.length >= 3)
    .map((u) => {
      const latlngs = projectPolygon(u.polygon_points, alignment);
      const coords = [...latlngs.map((p) => [p.lng, p.lat]), [latlngs[0].lng, latlngs[0].lat]];
      const style = UNIT_STATUS_STYLES[u.status];
      const dimmed = highlightStatus !== null && u.status !== highlightStatus;
      return {
        type: "Feature" as const,
        properties: {
          unitId: u.id,
          label: u.unit_number,
          fillColor: style.fill,
          strokeColor: style.border,
          opacity: dimmed ? 0.15 : 0.4,
        },
        geometry: { type: "Polygon" as const, coordinates: [coords] },
      };
    });
  return { type: "FeatureCollection" as const, features };
}
