// Projects a shape's fractional polygon (traced on the flat plan image, see
// PolygonPoint in lib/types.ts) onto real lat/lng coordinates once a
// sub-admin has satellite-aligned the project's plan image (project.map_bounds
// — the lat/lng rectangle the plan image's four corners line up with).
//
// This is a plain linear (equirectangular) interpolation, not a proper map
// projection — accurate enough for a small site/building footprint, and it
// avoids pulling in a full projection library for what is, at this zoom
// level, an effectively flat patch of the Earth.
import type { MapBounds, PolygonPoint } from "@/lib/types";

export interface LatLng {
  lat: number;
  lng: number;
}

export function projectPoint(point: PolygonPoint, bounds: MapBounds): LatLng {
  const lat = bounds.north + (bounds.south - bounds.north) * point.y;
  const lng = bounds.west + (bounds.east - bounds.west) * point.x;
  return { lat, lng };
}

export function projectPolygon(points: PolygonPoint[], bounds: MapBounds): LatLng[] {
  return points.map((p) => projectPoint(p, bounds));
}

// Inverse of projectPoint — used while dragging a corner handle in
// SatelliteLayoutEditor to figure out which fractional corner of the plan
// image a lat/lng drag position corresponds to.
export function unprojectPoint(latLng: LatLng, bounds: MapBounds): PolygonPoint {
  const y = (latLng.lat - bounds.north) / (bounds.south - bounds.north);
  const x = (latLng.lng - bounds.west) / (bounds.east - bounds.west);
  return { x, y };
}
