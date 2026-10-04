// Road width labels are free text ("30 ft", "Road", ...). These helpers turn
// one into the text the public map shows, and tell the dashboard which roads
// have no usable width.

// The number in a label, or null when there is none ("Road", "", "main").
export function parseRoadWidthFeet(label: string): number | null {
  const m = label.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function hasRoadWidth(label: string): boolean {
  return parseRoadWidthFeet(label) !== null;
}

// What the map writes on a road:
//  - the saved number if there is one ("30 ft"),
//  - otherwise the width worked out from the measured gap between the plot
//    blocks and the project's map scale, rounded to the nearest 5 ft,
//  - otherwise nothing. It never shows a word like "Road".
export function roadLabelText(label: string, widthUnits: number, feetPerUnit: number | null): string | null {
  const saved = parseRoadWidthFeet(label);
  if (saved !== null) return `${Math.round(saved)} ft`;
  if (feetPerUnit && feetPerUnit > 0) {
    const ft = Math.round((widthUnits * feetPerUnit) / 5) * 5;
    if (ft > 0) return `${ft} ft`;
  }
  return null;
}
