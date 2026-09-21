// Converts a raw client (screen) pixel position into the SAME coordinate
// space a given SVG element renders in — using getScreenCTM()/inverse()
// rather than reading getBoundingClientRect() (the technique PolygonTracer
// uses) specifically because this canvas has a pan/zoom transform on an
// ancestor <g> that PolygonTracer never needed to account for. getScreenCTM
// gives the FULL accumulated transform (including that CSS transform) from
// the element's own local space to the screen, so inverting it correctly
// un-does pan/zoom regardless of its current value.
export function clientPointToLocalFraction(
  referenceEl: SVGGraphicsElement,
  clientX: number,
  clientY: number,
  viewBoxSize: number,
): { x: number; y: number } | null {
  // `ownerSVGElement` is the nearest ANCESTOR <svg> — for a child element
  // (a shape, a vertex handle) that's the canvas's root <svg>, but for the
  // root <svg> element itself it's `null` (there's no ancestor, since it
  // IS the svg). ReviewCanvas passes its own root <svg> directly for its
  // background click-to-draw and wheel-zoom handlers, which made both of
  // those silently do nothing — no error, `clientPointToLocalFraction`
  // just returned `null` every time — found via a real end-to-end test
  // (drawing a plot manually and finding the click never registered a
  // point) after the user reported the manual "Draw plot"/"Draw road"
  // tools not working.
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
