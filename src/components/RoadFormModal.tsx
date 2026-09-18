"use client";

// Form shown right after a sub-admin finishes tracing a road's centerline
// on the project's master plan — just a width. Offers the common presets
// from the spec as one-click buttons, plus a free-text fallback for a
// width that doesn't match one of them.
import { useState } from "react";
import { createRoad } from "@/lib/actions/roads";
import { ROAD_WIDTH_PRESETS, type PolygonPoint } from "@/lib/types";

export function RoadFormModal({
  projectId,
  pathPoints,
  onClose,
  onSaved,
}: {
  projectId: string;
  pathPoints: PolygonPoint[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [widthLabel, setWidthLabel] = useState(ROAD_WIDTH_PRESETS[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!widthLabel.trim()) return;
    setSaving(true);
    setError(null);
    const result = await createRoad(projectId, widthLabel.trim(), pathPoints);
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm space-y-3 rounded-lg bg-white p-6 shadow-xl dark:bg-gray-900"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Road width</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {ROAD_WIDTH_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setWidthLabel(preset)}
              className={`rounded-full border px-3 py-1 text-sm ${
                widthLabel === preset
                  ? "border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900"
                  : "border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
              }`}
            >
              {preset}
            </button>
          ))}
        </div>

        <label className="block text-sm">
          Or a custom width
          <input
            value={widthLabel}
            onChange={(e) => setWidthLabel(e.target.value)}
            placeholder="e.g. 45 ft"
            className="mt-1 w-full rounded-md border border-gray-300 p-2 dark:border-gray-700 dark:bg-gray-800"
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={saving || !widthLabel.trim()}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-60 dark:bg-white dark:text-gray-900"
          >
            {saving ? "Saving…" : "Save road"}
          </button>
        </div>
      </form>
    </div>
  );
}
