"use client";

// Public satellite map for a project that has been aligned.
//
// Layer order (bottom → top):
//   1. Esri World Imagery tiles (base)
//   2. Plan image overlay as a MapLibre raster "image" source — shows the
//      whole plan (roads, plot colours, numbers, amenities) at 85% opacity.
//   3. Roads as GeoJSON LineStrings — visible outside the plan image boundary.
//   4. Site features as GeoJSON filled polygons — same idea.
//   5. Plot fills + outlines (GeoJSON) — status colours, dimmed by filter.
//   6. Plot labels (unit numbers).
//
// Clicking a plot polygon fires onPlotClick so the caller opens UnitInfoCard.
import { useEffect, useMemo, useRef } from "react";
import { computeCorners, projectPoint, projectPolygon } from "@/lib/map/geo";
import { ESRI_TILE_URL, ESRI_ATTRIBUTION } from "@/lib/satellite";
import { SITE_FEATURE_STYLES, UNIT_STATUS_STYLES } from "@/lib/types";
import type { Road, SiteFeature, SatelliteAlignment, Unit, UnitStatus } from "@/lib/types";

interface Props {
  alignment: SatelliteAlignment;
  plots: Unit[];
  roads?: Road[];
  features?: SiteFeature[];
  planImageUrl?: string;
  highlightStatus: UnitStatus | null;
  onPlotClick: (unit: Unit) => void;
}

export function SatelliteView({
  alignment, plots, roads = [], features = [], planImageUrl,
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
      if (!containerRef.current || mapRef.current) return;
      const center: [number, number] = [stableAlignment.center.lng, stableAlignment.center.lat];
      const map = new mod.Map({
        container: containerRef.current,
        style: {
          version: 8,
          sources: {
            esri: { type: "raster", tiles: [ESRI_TILE_URL], tileSize: 256, attribution: ESRI_ATTRIBUTION },
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

        // Plan image overlay
        if (planImageUrl) {
          map.addSource("plan", { type: "image", url: planImageUrl, coordinates: computeCorners(a) });
          map.addLayer({ id: "plan-layer", type: "raster", source: "plan", paint: { "raster-opacity": 0.85 } });
        }

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

// ---------- GeoJSON builders ----------

function buildPlotsGeoJSON(plots: Unit[], a: SatelliteAlignment, highlightStatus: UnitStatus | null) {
  const features = plots
    .filter((u) => u.polygon_points.length >= 3)
    .map((u) => {
      const latlngs = projectPolygon(u.polygon_points, a);
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
          fillOpacity: dimmed ? 0.05 : 0.35,
          outlineOpacity: dimmed ? 0.2 : 1,
          labelOpacity: dimmed ? 0.2 : 1,
        },
        geometry: { type: "Polygon" as const, coordinates: [coords] },
      };
    });
  return { type: "FeatureCollection" as const, features };
}

function buildRoadsGeoJSON(roads: Road[], a: SatelliteAlignment) {
  const features = roads
    .filter((r) => r.path_points.length >= 2)
    .map((r) => {
      const latlngs = r.path_points.map((p) => projectPoint(p, a));
      const coords = latlngs.map((p) => [p.lng, p.lat]);
      // Parse feet from label like "30 ft" → display-width ≈ ft × 0.1 px (rough scale at zoom 17)
      const ft = parseFloat(r.width_label) || 30;
      const lineWidth = Math.max(2, Math.round(ft * 0.08));
      return {
        type: "Feature" as const,
        properties: { widthLabel: r.width_label, lineWidth },
        geometry: { type: "LineString" as const, coordinates: coords },
      };
    });
  return { type: "FeatureCollection" as const, features };
}

function buildFeaturesGeoJSON(features: SiteFeature[], a: SatelliteAlignment) {
  const geoFeatures = features
    .filter((f) => f.polygon_points.length >= 3)
    .map((f) => {
      const latlngs = projectPolygon(f.polygon_points, a);
      const coords = [...latlngs.map((p) => [p.lng, p.lat]), [latlngs[0].lng, latlngs[0].lat]];
      const style = SITE_FEATURE_STYLES[f.kind];
      return {
        type: "Feature" as const,
        properties: { label: f.label, fillColor: style.fill, borderColor: style.border },
        geometry: { type: "Polygon" as const, coordinates: [coords] },
      };
    });
  return { type: "FeatureCollection" as const, features: geoFeatures };
}
