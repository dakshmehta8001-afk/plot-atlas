// Small colored pill showing a unit's sale status. Shares its color mapping
// with the map viewers' polygon fill colors (see UNIT_STATUS_STYLES in
// src/lib/types.ts) so the badge next to a unit's name always matches the
// color of its polygon on the map.
import { UNIT_STATUS_STYLES, type UnitStatus } from "@/lib/types";

export function StatusBadge({ status }: { status: UnitStatus }) {
  const style = UNIT_STATUS_STYLES[status];
  return (
    <span
      className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium"
      style={{ backgroundColor: style.fill, borderColor: style.border, color: style.border }}
    >
      {style.label}
    </span>
  );
}

// Category (premium/standard/...) is free text set per-project by the
// sub-admin, so it just gets a neutral badge rather than a fixed color map.
export function CategoryBadge({ category }: { category: string | null }) {
  if (!category) return null;
  return (
    <span className="inline-flex items-center rounded-full border border-gray-300 bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200">
      {category}
    </span>
  );
}
