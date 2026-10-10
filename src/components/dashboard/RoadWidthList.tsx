"use client";

// Dashboard list of a project's roads and their widths. A road with no
// number in its width label (for example "Road") shows no width on the public
// map, so those are listed first, highlighted, with a picker to fix them.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateRoadWidth } from "@/lib/actions/roads";
import { hasRoadWidth } from "@/lib/map/roadWidth";
import { ROAD_WIDTH_PRESETS, type Road } from "@/lib/types";

function RoadRow({ road, index, projectId }: { road: Road; index: number; projectId: string }) {
  const router = useRouter();
  const missing = !hasRoadWidth(road.width_label);
  const [value, setValue] = useState(missing ? "" : road.width_label);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = value !== "" && value !== road.width_label;

  async function save() {
    setSaving(true);
    setError(null);
    const result = await updateRoadWidth(road.id, projectId, value);
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <li className={`flex flex-wrap items-center gap-3 p-3 ${missing ? "bg-amber-50 dark:bg-amber-950/30" : ""}`}>
      <span className="w-20 text-sm font-medium">Road {index + 1}</span>
      <span className={`w-28 text-sm ${missing ? "font-medium text-amber-700 dark:text-amber-400" : "text-gray-600 dark:text-gray-300"}`}>
        {missing ? "No width set" : road.width_label}
      </span>
      <select
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label={`Width for road ${index + 1}`}
        className="rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-800"
      >
        {missing && <option value="">Choose a width…</option>}
        {!missing && !ROAD_WIDTH_PRESETS.includes(road.width_label) && <option value={road.width_label}>{road.width_label}</option>}
        {ROAD_WIDTH_PRESETS.map((w) => (
          <option key={w} value={w}>
            {w}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={save}
        disabled={!changed || saving}
        className="rounded-md bg-gray-900 px-3 py-1 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-gray-900"
      >
        {saving ? "Saving…" : "Save"}
      </button>
      {error && <span className="text-sm text-red-600">{error}</span>}
    </li>
  );
}

export function RoadWidthList({ projectId, roads }: { projectId: string; roads: Road[] }) {
  if (roads.length === 0) return null;
  // Keep each road's number stable (its order of tracing), but list the ones
  // with no width first.
  const numbered = roads.map((road, index) => ({ road, index }));
  const sorted = [...numbered].sort((a, b) => Number(hasRoadWidth(a.road.width_label)) - Number(hasRoadWidth(b.road.width_label)));
  const missingCount = numbered.filter((r) => !hasRoadWidth(r.road.width_label)).length;
  return (
    <div className="mt-8">
      <h2 className="mb-1 text-lg font-semibold">Roads</h2>
      {missingCount > 0 ? (
        <p className="mb-3 text-sm text-amber-700 dark:text-amber-400">
          {missingCount} road{missingCount === 1 ? " has" : "s have"} no width. The public map shows no width label on {missingCount === 1 ? "it" : "them"} until you set one.
        </p>
      ) : (
        <p className="mb-3 text-sm text-gray-500">Every road has a width.</p>
      )}
      <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
        {sorted.map(({ road, index }) => (
          <RoadRow key={road.id} road={road} index={index} projectId={projectId} />
        ))}
      </ul>
    </div>
  );
}
