"use client";

import { UNIT_STATUS_OPTIONS, UNIT_STATUS_STYLES } from "@/lib/types";

export function Legend() {
  const items = [
    ...UNIT_STATUS_OPTIONS.map((status) => ({ label: UNIT_STATUS_STYLES[status].label, color: UNIT_STATUS_STYLES[status].border })),
    { label: "Road", color: "#f5c94b" },
    { label: "Park / common area", color: "#15803d" },
  ];

  return (
    <div className="flex flex-wrap gap-3 text-xs text-gray-500 dark:text-gray-400">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}
