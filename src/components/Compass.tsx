// Purely decorative N/E/S/W compass badge shown over the map, matching the
// reference design. Doesn't reflect the plan image's actual orientation —
// there's no data source for that (the sub-admin doesn't record which way
// the uploaded plan is rotated), so this is a fixed visual cue only and
// deliberately never rotates.
export function Compass() {
  return (
    <div className="pointer-events-none absolute left-1/2 top-16 z-[500] -translate-x-1/2 select-none sm:top-20">
      <div className="relative flex h-11 w-11 items-center justify-center rounded-full border border-map-border bg-map-panel/80 shadow-lg backdrop-blur">
        <span className="absolute top-1 text-[9px] font-semibold text-map-text/90">N</span>
        <span className="absolute bottom-1 text-[9px] font-semibold text-map-muted">S</span>
        <span className="absolute left-1.5 text-[9px] font-semibold text-map-muted">W</span>
        <span className="absolute right-1.5 text-[9px] font-semibold text-map-muted">E</span>
        <span className="h-1.5 w-1.5 rounded-full bg-map-text/80" />
      </div>
    </div>
  );
}
