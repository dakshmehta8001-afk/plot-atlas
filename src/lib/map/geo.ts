// Projects a shape's fractional polygon (traced on the flat plan image) onto
// real lat/lng coordinates using the SatelliteAlignment stored in
// project.map_bounds. Also provides helpers for deriving the alignment from
// a project calibration and for computing the plan image's four geo corners
// (used by MapLibre's image source).
//
// The alignment model: plan centre (0.5, 0.5) sits at alignment.center. The
// plan's UP direction (−y axis) points at bearing alignment.northAngle
// (clockwise degrees from true north). mppX / mppY give real-world metres
// per 1.0 plan unit on each axis. This is a similarity transform (no shear).
import type { MapCalibration, PolygonPoint, SatelliteAlignment } from "@/lib/types";

export interface LatLng {
  lat: number;
  lng: number;
}

const M_PER_DEG_LAT = 111320;

function mPerDegLng(lat: number) {
  return M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
}

// Project any plan point (px, py in 0..1) to geo.
// Movement in plan space:
//   right (+x) → bearing (northAngle + 90)°
//   up    (−y) → bearing northAngle°
export function projectPoint(point: PolygonPoint, a: SatelliteAlignment): LatLng {
  const dx = (point.x - 0.5) * a.mppX; // metres, positive = plan right
  const dy = (0.5 - point.y) * a.mppY; // metres, positive = plan up
  const nRad = (a.northAngle * Math.PI) / 180;
  // Δlat = (dy·cos n  −  dx·sin n) / M_PER_DEG_LAT
  // Δlng = (dy·sin n  +  dx·cos n) / mPerDegLng
  const cos = Math.cos(nRad);
  const sin = Math.sin(nRad);
  return {
    lat: a.center.lat + (dy * cos - dx * sin) / M_PER_DEG_LAT,
    lng: a.center.lng + (dy * sin + dx * cos) / mPerDegLng(a.center.lat),
  };
}

export function projectPolygon(points: PolygonPoint[], a: SatelliteAlignment): LatLng[] {
  return points.map((p) => projectPoint(p, a));
}

// Inverse: geo → plan fractional point. Used while dragging the plan overlay.
export function unprojectPoint(geo: LatLng, a: SatelliteAlignment): PolygonPoint {
  const latM = (geo.lat - a.center.lat) * M_PER_DEG_LAT;
  const lngM = (geo.lng - a.center.lng) * mPerDegLng(a.center.lat);
  const nRad = (a.northAngle * Math.PI) / 180;
  const cos = Math.cos(nRad);
  const sin = Math.sin(nRad);
  // Inverse rotation: dy = latM·cos n + lngM·sin n, dx = −latM·sin n + lngM·cos n
  const dy = latM * cos + lngM * sin;
  const dx = -latM * sin + lngM * cos;
  return { x: 0.5 + dx / a.mppX, y: 0.5 - dy / a.mppY };
}

// The plan image's four geo corners, in MapLibre image-source order:
// top-left, top-right, bottom-right, bottom-left (counter-clockwise).
export function computeCorners(a: SatelliteAlignment): [[number, number], [number, number], [number, number], [number, number]] {
  const tl = projectPoint({ x: 0, y: 0 }, a);
  const tr = projectPoint({ x: 1, y: 0 }, a);
  const br = projectPoint({ x: 1, y: 1 }, a);
  const bl = projectPoint({ x: 0, y: 1 }, a);
  return [
    [tl.lng, tl.lat],
    [tr.lng, tr.lat],
    [br.lng, br.lat],
    [bl.lng, bl.lat],
  ];
}

// Build a SatelliteAlignment from a project calibration + one geo reference
// point (the plan's centre, 0.5, 0.5). feetPerUnit is the same calculation
// calibration.ts makes for computing plot dimensions.
export function autoAlignFromCalibration(
  centerLat: number,
  centerLng: number,
  cal: MapCalibration,
  imgW: number,
  imgH: number,
): SatelliteAlignment {
  const axS = cal.pointA.x * imgW;
  const ayS = cal.pointA.y * imgH;
  const bxS = cal.pointB.x * imgW;
  const byS = cal.pointB.y * imgH;
  const calDist = Math.hypot(bxS - axS, byS - ayS);
  const FT_TO_M = 0.3048;
  const fpu = calDist > 0 ? cal.realDistanceFt / calDist : 1;
  return {
    center: { lat: centerLat, lng: centerLng },
    northAngle: cal.northAngleDegrees ?? 0,
    mppX: imgW * fpu * FT_TO_M,
    mppY: imgH * fpu * FT_TO_M,
  };
}
