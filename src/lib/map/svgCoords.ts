// Converts a raw client (screen) pixel position into the SAME coordinate
// space a given SVG element renders in — using getScreenCTM()/inverse()
// rather than reading getBoundingClientRect() (the technique PolygonTracer
// uses) specifically because callers with a pan/zoom transform on an
// ancestor <g> need to account for that. getScreenCTM gives the FULL
// accumulated transform (including that CSS transform) from the element's
// own local space to the screen, so inverting it correctly un-does pan/zoom
// regardless of its current value.
//
// Shared by both src/components/digitize/ (the review/edit canvas) and
// src/components/SitePlanViewer.tsx (the public free pan/zoom viewer) —
// lives here rather than under digitize/ since it's generic coordinate math,
// not digitize-specific.
export function clientPointToLocalFraction(
  referenceEl: SVGGraphicsElement,
  clientX: number,
  clientY: number,
  viewBoxSize: number,
): { x: number; y: number } | null {
  // `ownerSVGElement` is the nearest ANCESTOR <svg> — for a child element
  // (a shape, a vertex handle) that's the canvas's root <svg>, but for the
  // root <svg> element itself it's `null` (there's no ancestor, since it
  // IS the svg). Callers must pass an element INSIDE any transformed group,
  // never an ancestor of it — passing the outer <svg> itself when a child
  // <g> carries the pan/zoom transform silently returns coordinates that
  // ignore that transform (found via a real end-to-end bug in the digitize
  // canvas where clicks stopped registering correctly once zoomed).
  const svg = referenceEl instanceof SVGSVGElement ? referenceEl : referenceEl.ownerSVGElement;
  if (!svg) return null;
  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const ctm = referenceEl.getScreenCTM();
  if (!ctm) return null;
  const local = point.matrixTransform(ctm.inverse());
  return { x: local.x / viewBoxSize, y: local.y / viewBoxSize };
}
