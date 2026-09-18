// Purely decorative N/E/S/W compass badge shown over the map, matching the
// reference design. Doesn't reflect the plan image's actual orientation —
// there's no data source for that (the sub-admin doesn't record which way
// the uploaded plan is rotated), so this is a fixed visual cue only.
export function Compass() {
  return (
    <div className="pointer-events-none absolute left-1/2 top-20 z-[500] -translate-x-1/2 select-none text-center text-[10px] font-semibold text-white/70">
      <div>N</div>
      <div className="flex items-center gap-3">
        <span>W</span>
        <span className="h-2 w-2 rounded-full border border-white/70" />
        <span>E</span>
      </div>
      <div>S</div>
    </div>
  );
}
