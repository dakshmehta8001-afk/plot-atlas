"use client";

// Public satellite map for a project that has been aligned.
//
// Layer order (bottom → top):
//   1. Esri World Imagery tiles (base)
//   2. Roads as GeoJSON LineStrings (digitized centrelines).
//   3. Site features as GeoJSON filled polygons (digitized amenities).
//   4. Plot fills + outlines (GeoJSON) — status colours, dimmed by filter.
//   5. Plot labels (unit numbers).
//
// Only the digitized shapes are drawn — not the raw plan image file.
// Clicking a plot polygon fires onPlotClick so the caller opens UnitInfoCard.
import { useEffect, useMemo, useRef } from "react";
import { buildFeaturesGeoJSON, buildPlotsGeoJSON, buildRoadsGeoJSON } from "@/lib/map/satelliteGeoJson";
import { ESRI_TILE_URL, ESRI_ATTRIBUTION } from "@/lib/satellite";
import type { Road, SiteFeature, SatelliteAlignment, Unit, UnitStatus } from "@/lib/types";
import { configureMaplibreWorker } from "@/lib/map/maplibreWorker";

interface Props {
  alignment: SatelliteAlignment;
  plots: Unit[];
  roads?: Road[];
  features?: SiteFeature[];
  highlightStatus: UnitStatus | null;
  onPlotClick: (unit: Unit) => void;
}

export function SatelliteView({
  alignment, plots, roads = [], features = [],
  highlightStatus, onPlotClick,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);

  // Store latest props in refs so map handlers always have fresh values
  const plotsRef = useRef(plots);
  const onPlotClickRef = useRef(onPlotClick);
  const highlightStatusRef = useRef(highlightStatus);
  useEffect(() => { plotsRef.current = plots; }, [plots]);
  useEffect(() => { onPlotClickRef.current = onPlotClick; }, [onPlotClick]);
  useEffect(() => { highlightStatusRef.current = highlightStatus; }, [highlightStatus]);

  // Stable alignment reference — useMemo keyed on the scalar fields so the
  // identity only changes when a value actually changes, not on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableAlignment = useMemo(() => alignment, [
    alignment.center.lat, alignment.center.lng, alignment.northAngle,
    alignment.mppX, alignment.mppY,
  ]);

  // Initialise map once
  useEffect(() => {
    if (!containerRef.current) return;
    import("maplibre-gl").then((mod) => {
      configureMaplibreWorker(mod);
      if (!containerRef.current || mapRef.current) return;
      const center: [number, number] = [stableAlignment.center.lng, stableAlignment.center.lat];
      const map = new mod.Map({
        container: containerRef.current,
        style: {
          version: 8,
          sources: {
            esri: { type: "raster", tiles: [ESRI_TILE_URL], tileSize: 256, maxzoom: 18, attribution: ESRI_ATTRIBUTION },
          },
          layers: [{ id: "esri-layer", type: "raster", source: "esri" }],
        },
        center,
        zoom: 17,
        attributionControl: { compact: false },
      });
      mapRef.current = map;

      map.on("load", () => {
        const a = stableAlignment;

        // Roads
        if (roads.length > 0) {
          map.addSource("roads", { type: "geojson", data: buildRoadsGeoJSON(roads, a) });
          map.addLayer({
            id: "roads-line",
            type: "line",
            source: "roads",
            paint: { "line-color": "#e2c97e", "line-width": ["get", "lineWidth"], "line-opacity": 0.5 },
          });
        }

        // Site features
        if (features.length > 0) {
          map.addSource("features", { type: "geojson", data: buildFeaturesGeoJSON(features, a) });
          map.addLayer({
            id: "features-fill",
            type: "fill",
            source: "features",
            paint: { "fill-color": ["get", "fillColor"], "fill-opacity": 0.4 },
          });
          map.addLayer({
            id: "features-outline",
            type: "line",
            source: "features",
            paint: { "line-color": ["get", "borderColor"], "line-width": 1 },
          });
        }

        // Plot fills + outlines + labels
        map.addSource("plots", { type: "geojson", data: buildPlotsGeoJSON(plotsRef.current, a, highlightStatusRef.current) });
        map.addLayer({
          id: "plots-fill",
          type: "fill",
          source: "plots",
          paint: { "fill-color": ["get", "fillColor"], "fill-opacity": ["get", "fillOpacity"] },
        });
        map.addLayer({
          id: "plots-outline",
          type: "line",
          source: "plots",
          paint: { "line-color": ["get", "strokeColor"], "line-width": 1.5, "line-opacity": ["get", "outlineOpacity"] },
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
          paint: { "text-color": "#ffffff", "text-halo-color": "#000000", "text-halo-width": 1.5, "text-opacity": ["get", "labelOpacity"] },
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
    return () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only init on mount
  }, []);

  // Re-sync plot data whenever plots or filter changes (map may not be loaded yet — guard)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.loaded()) return;
    const src = map.getSource("plots");
    if (src) src.setData(buildPlotsGeoJSON(plots, stableAlignment, highlightStatus));
  }, [plots, stableAlignment, highlightStatus]);

  return <div ref={containerRef} className="absolute inset-0" />;
}
