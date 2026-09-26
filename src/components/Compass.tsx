// N/E/S/W compass badge shown over the map. When a project has a captured
// north angle (set once during digitize review via the "Set north" tool —
// see src/lib/calibration.ts's northAngleFromPoints and ReviewCanvas's
// set-north gesture), the needle rotates to reflect the plan's ACTUAL
// printed orientation instead of just decorating the map; projects that
// predate this (or skipped the optional step) fall back to the original
// fixed, non-rotating look with angleDegrees left undefined/null.
//
// Repositioned from top-center to the map's top-left corner: top-right is
// already used by SitePlanViewer's "← Back to full view" button, which can
// be visible AT THE SAME TIME as this (zooming into a plot doesn't change
// drilldownStage away from "site", so the header chrome — and this
// Compass — can still be showing) — top-left avoids that collision, and
// nothing else in the map area's chrome uses that corner while at the
// site level.
export function Compass({ angleDegrees }: { angleDegrees?: number | null }) {
  return (
    <div className="pointer-events-none absolute left-3 top-3 z-[500] select-none">
      <div className="relative flex h-11 w-11 items-center justify-center rounded-full border border-map-border bg-map-panel/80 shadow-lg backdrop-blur">
        <span className="absolute top-1 text-[9px] font-semibold text-map-text/90">N</span>
        <span className="absolute bottom-1 text-[9px] font-semibold text-map-muted">S</span>
        <span className="absolute left-1.5 text-[9px] font-semibold text-map-muted">W</span>
        <span className="absolute right-1.5 text-[9px] font-semibold text-map-muted">E</span>
        {/* The needle itself is the only part that rotates — the N/E/S/W
            labels stay fixed (they label the MAP's edges, not true north),
            same convention every real compass rosette uses. 0deg = up,
            CSS's own rotate() is already clockwise for positive values,
            matching northAngleFromPoints's convention exactly (see its own
            comment for why), so no sign-flipping is needed here. */}
        <span
          className="absolute h-3 w-0.5 rounded-full bg-red-400"
          style={{
            transform: `rotate(${angleDegrees ?? 0}deg)`,
            transformOrigin: "50% 100%",
            bottom: "50%",
          }}
        />
        <span className="h-1.5 w-1.5 rounded-full bg-map-text/80" />
      </div>
    </div>
  );
}
