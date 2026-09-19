"use client";

// Live Total/Available/Hold/Sold counts over the in-progress shape list —
// recomputed on every render straight from `shapes`, so there's no separate
// count state to fall out of sync with edits (add/delete/status-change all
// just flow through the same array).
import type { DetectedShape } from "@/lib/digitize/types";

export function CountsHeader({ shapes }: { shapes: DetectedShape[] }) {
  const plots = shapes.filter((s) => s.kind === "plot");
  const counts = {
    total: plots.length,
    available: plots.filter((p) => (p.status ?? "available") === "available").length,
    hold: plots.filter((p) => p.status === "hold").length,
    sold: plots.filter((p) => p.status === "sold").length,
    roads: shapes.filter((s) => s.kind === "road").length,
    areas: shapes.filter((s) => s.kind === "feature").length,
  };

  const pills: { label: string; value: number; className: string }[] = [
    { label: "Total plots", value: counts.total, className: "border-gray-300 text-gray-700 dark:border-gray-600 dark:text-gray-200" },
    { label: "Available", value: counts.available, className: "border-green-500/60 text-green-600 dark:text-green-400" },
    { label: "Hold", value: counts.hold, className: "border-yellow-500/60 text-yellow-600 dark:text-yellow-400" },
    { label: "Sold", value: counts.sold, className: "border-red-500/60 text-red-600 dark:text-red-400" },
    { label: "Roads", value: counts.roads, className: "border-amber-500/60 text-amber-600 dark:text-amber-400" },
    { label: "Areas", value: counts.areas, className: "border-purple-500/60 text-purple-600 dark:text-purple-400" },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {pills.map((pill) => (
        <span key={pill.label} className={`rounded-full border px-3 py-1 text-xs font-medium ${pill.className}`}>
          {pill.label} <span className="font-bold">{pill.value}</span>
        </span>
      ))}
    </div>
  );
}
