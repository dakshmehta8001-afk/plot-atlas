// Shown immediately when the browser navigates to /projects/[slug] —
// before the server fetches project data. Gives instant visual feedback
// so the page doesn't appear frozen during the 8 parallel DB queries.
export default function ProjectLoading() {
  return (
    <main className="flex min-h-0 w-full flex-1 flex-col bg-[var(--map-background)] animate-pulse">
      {/* Header skeleton */}
      <div className="flex items-center gap-4 border-b border-white/10 p-4 sm:p-6">
        <div className="h-5 w-5 rounded bg-white/10" />
        <div className="flex flex-col gap-1.5 flex-1">
          <div className="h-5 w-48 rounded-lg bg-white/10" />
          <div className="h-3 w-32 rounded-lg bg-white/8" />
        </div>
        <div className="flex gap-2">
          <div className="h-7 w-20 rounded-full bg-white/8" />
          <div className="h-7 w-16 rounded-full bg-white/8" />
          <div className="h-7 w-14 rounded-full bg-white/8" />
        </div>
      </div>
      {/* Map area skeleton */}
      <div className="relative flex-1">
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4 text-white/30">
            <svg
              className="h-10 w-10 animate-spin opacity-60"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="3"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
              />
            </svg>
            <span className="text-sm font-medium">Loading project…</span>
          </div>
        </div>
        {/* Grid shimmer lines mimicking a plot layout */}
        <svg
          className="absolute inset-0 h-full w-full opacity-[0.04]"
          preserveAspectRatio="xMidYMid slice"
        >
          <defs>
            <pattern id="grid" width="80" height="80" patternUnits="userSpaceOnUse">
              <path d="M 80 0 L 0 0 0 80" fill="none" stroke="white" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
      </div>
    </main>
  );
}
