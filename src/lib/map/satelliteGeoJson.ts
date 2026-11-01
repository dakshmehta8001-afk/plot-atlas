// Shared GeoJSON builders: project the digitized plots, roads and site
// features onto the map using a SatelliteAlignment. Used by the public
// satellite view and by the admin alignment tool, so both draw the same shapes.
import { projectPoint, projectPolygon } from "@/lib/map/geo";
import { SITE_FEATURE_STYLES, UNIT_STATUS_STYLES } from "@/lib/types";
import type { Road, SatelliteAlignment, SiteFeature, Unit, UnitStatus } from "@/lib/types";

export function buildPlotsGeoJSON(plots: Unit[], a: SatelliteAlignment, highlightStatus: UnitStatus | null) {
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

export function buildRoadsGeoJSON(roads: Road[], a: SatelliteAlignment) {
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

export function buildFeaturesGeoJSON(features: SiteFeature[], a: SatelliteAlignment) {
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
