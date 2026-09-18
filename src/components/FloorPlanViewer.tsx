"use client";

// Viewer-facing map of a single floor's plate layout: renders every flat
// traced on that floor as an SVG polygon, colored by sale status, with the
// same click-to-zoom interaction as SitePlanViewer. Used inside
// BuildingDrilldown once a viewer has picked a floor from the floor
// selector.
import { useMemo, useState } from "react";
import { MAP_VIEWBOX_SIZE, UNIT_STATUS_STYLES, type Unit } from "@/lib/types";
import { useImageAspectRatio } from "@/lib/useImageAspectRatio";
import { toSvgPoints, boundingBoxCenter } from "@/lib/svgPolygon";

const VB = MAP_VIEWBOX_SIZE;
const ZOOM_SCALE = 3;

export function FloorPlanViewer({
  planImageUrl,
  flats,
  onFlatClick,
}: {
  planImageUrl: string;
  flats: Unit[];
  onFlatClick: (unit: Unit) => void;
}) {
  const [zoomedId, setZoomedId] = useState<string | null>(null);
  const aspectRatio = useImageAspectRatio(planImageUrl);

  const transform = useMemo(() => {
    const flat = flats.find((f) => f.id === zoomedId);
    if (!flat || flat.polygon_points.length < 3) return "translate(0px, 0px) scale(1)";
    const center = boundingBoxCenter(flat.polygon_points);
    const target = VB / 2;
    const tx = target - ZOOM_SCALE * center.x;
    const ty = target - ZOOM_SCALE * center.y;
    return `translate(${tx}px, ${ty}px) scale(${ZOOM_SCALE})`;
  }, [flats, zoomedId]);

  function handleClick(unit: Unit) {
    setZoomedId(unit.id);
    onFlatClick(unit);
  }

  return (
    <div className="relative h-full w-full">
      {zoomedId && (
        <button
          type="button"
          onClick={() => setZoomedId(null)}
          className="absolute right-3 top-3 z-10 rounded-md bg-white/90 px-3 py-1.5 text-sm font-medium text-[#0f2436] shadow hover:bg-white"
        >
          ← Back to floor view
        </button>
      )}
      <div className="h-full w-full overflow-hidden" style={{ aspectRatio }}>
        <svg viewBox={`0 0 ${VB} ${VB}`} preserveAspectRatio="none" className="h-full w-full bg-[#0b1f2e]">
          <g style={{ transform, transformOrigin: "0 0", transition: "transform 500ms ease" }}>
            <image href={planImageUrl} x={0} y={0} width={VB} height={VB} preserveAspectRatio="none" />
            {flats.map((unit) => {
              if (unit.polygon_points.length < 3) return null;
              const style = UNIT_STATUS_STYLES[unit.status];
              return (
                <polygon
                  key={unit.id}
                  points={toSvgPoints(unit.polygon_points)}
                  fill={style.fill}
                  stroke={style.border}
                  strokeWidth={VB * 0.0025}
                  className="cursor-pointer transition-opacity hover:opacity-80"
                  onClick={() => handleClick(unit)}
                >
                  <title>
                    {unit.unit_number}
                    {unit.bhk_type ? ` · ${unit.bhk_type}` : ""}
                  </title>
                </polygon>
              );
            })}
          </g>
        </svg>
      </div>
    </div>
  );
}
