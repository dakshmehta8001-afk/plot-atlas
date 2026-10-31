export default function DashboardLoading() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="mb-4 h-6 w-40 rounded-full bg-white/5" />
      <div className="mb-8 h-9 w-72 rounded-lg bg-white/10" />
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-20 rounded-2xl border border-white/5 bg-white/[0.04]" />
        ))}
      </div>
    </div>
  );
}
