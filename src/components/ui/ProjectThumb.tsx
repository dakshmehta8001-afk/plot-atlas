// Thumbnail for a project card: the digitized layout redrawn as a clean survey
// drawing (plots tinted by status, roads as grey bands) instead of a cropped
// photo of the plan. Pure SVG, so it is sharp at any size and costs no image
// download. Open plots light up one after another when the card is hovered.
import type { PolygonPoint, UnitStatus } from "@/lib/types";

export interface ThumbLayout {
  plots: { points: PolygonPoint[]; status: UnitStatus }[];
  roads: PolygonPoint[][];
}

const FILL: Record<UnitStatus, string> = {
  available: "#cfeadb",
  hold: "#f6e3b4",
  booked: "#c9d9ec",
  sold: "#f3c9b8",
};
const STROKE: Record<UnitStatus, string> = {
  available: "#1f7a4d",
  hold: "#b7791f",
  booked: "#2f5d8a",
  sold: "#c2410c",
};

// A lot of plots in one thumbnail adds nothing visually; cap the work.
const MAX_PLOTS = 400;

export function ProjectThumb({ layout, width, height }: { layout: ThumbLayout; width: number; height: number }) {
  const plots = layout.plots.slice(0, MAX_PLOTS);
  // Fractions of the plan image -> image units, so a portrait plan stays portrait.
  const sx = (p: PolygonPoint) => p.x * width;
  const sy = (p: PolygonPoint) => p.y * height;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const shape of [...plots.map((p) => p.points), ...layout.roads]) {
    for (const p of shape) {
      minX = Math.min(minX, sx(p)); maxX = Math.max(maxX, sx(p));
      minY = Math.min(minY, sy(p)); maxY = Math.max(maxY, sy(p));
    }
  }
  if (!isFinite(minX)) return null;

  const bw = maxX - minX, bh = maxY - minY;
  const pad = Math.max(bw, bh) * 0.06;
  const stroke = Math.max(bw, bh) / 320;
  const pts = (shape: PolygonPoint[]) => shape.map((p) => `${sx(p).toFixed(1)},${sy(p).toFixed(1)}`).join(" ");

  let openIndex = 0;
  return (
    <svg
      viewBox={`${minX - pad} ${minY - pad} ${bw + pad * 2} ${bh + pad * 2}`}
      preserveAspectRatio="xMidYMid meet"
      className="h-full w-full"
      role="img"
      aria-label={`Layout of ${plots.length} plots`}
    >
      {layout.roads.map((r, i) => (
        <polyline
          key={`r${i}`}
          points={pts(r)}
          fill="none"
          stroke="#d3dde3"
          strokeWidth={Math.max(bw, bh) / 45}
          strokeLinecap="butt"
          strokeLinejoin="round"
        />
      ))}
      {plots.map((p, i) => {
        const open = p.status === "available";
        return (
          <polygon
            key={i}
            points={pts(p.points)}
            fill={FILL[p.status]}
            stroke={STROKE[p.status]}
            strokeWidth={stroke}
            strokeLinejoin="round"
            className={open ? "thumb-open" : undefined}
            style={open ? ({ "--i": openIndex++ } as React.CSSProperties) : undefined}
          />
        );
      })}
    </svg>
  );
}
