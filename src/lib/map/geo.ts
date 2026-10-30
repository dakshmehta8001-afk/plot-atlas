// Projects a shape's fractional polygon (traced on the flat plan image, see
// PolygonPoint in lib/types.ts) onto real lat/lng coordinates using the
// 2-control-point SatelliteAlignment stored in project.map_bounds.
//
// The transform is a 2D similarity (translate + uniform scale + rotation),
// derived from two matched plan/geo control points. No shear — accurate for
// a small site plan that isn't strongly distorted. No external projection
// library needed at these zoom levels.
import type { SatelliteAlignment, PolygonPoint } from "@/lib/types";

export interface LatLng {
  lat: number;
  lng: number;
}

// Solve for the similarity coefficients (a, b) from the two control points,
// then apply: lat = lat1 + a*Δpx - b*Δpy, lng = lng1 + b*Δpx + a*Δpy.
export function projectPoint(point: PolygonPoint, alignment: SatelliteAlignment): LatLng {
  const { plan1, geo1, plan2, geo2 } = alignment;
  const dpx = plan2.x - plan1.x;
  const dpy = plan2.y - plan1.y;
  const d2 = dpx * dpx + dpy * dpy;
  if (d2 === 0) return geo1;
  const dlat = geo2.lat - geo1.lat;
  const dlng = geo2.lng - geo1.lng;
  const a = (dlat * dpx + dlng * dpy) / d2;
  const b = (dlng * dpx - dlat * dpy) / d2;
  const px = point.x - plan1.x;
  const py = point.y - plan1.y;
  return { lat: geo1.lat + a * px - b * py, lng: geo1.lng + b * px + a * py };
}

export function projectPolygon(points: PolygonPoint[], alignment: SatelliteAlignment): LatLng[] {
  return points.map((p) => projectPoint(p, alignment));
}

// Inverse: given a lat/lng (e.g., from a map click) find the fractional plan
// coordinate. Used in AlignmentTool to show the plan crosshair while the user
// hovers the satellite map.
export function unprojectPoint(latLng: LatLng, alignment: SatelliteAlignment): PolygonPoint {
  const { plan1, geo1, plan2, geo2 } = alignment;
  const dpx = plan2.x - plan1.x;
  const dpy = plan2.y - plan1.y;
  const d2 = dpx * dpx + dpy * dpy;
  if (d2 === 0) return plan1;
  const dlat = geo2.lat - geo1.lat;
  const dlng = geo2.lng - geo1.lng;
  const a = (dlat * dpx + dlng * dpy) / d2;
  const b = (dlng * dpx - dlat * dpy) / d2;
  const ab2 = a * a + b * b;
  if (ab2 === 0) return plan1;
  const glat = latLng.lat - geo1.lat;
  const glng = latLng.lng - geo1.lng;
  return {
    x: plan1.x + (a * glat + b * glng) / ab2,
    y: plan1.y + (-b * glat + a * glng) / ab2,
  };
}
