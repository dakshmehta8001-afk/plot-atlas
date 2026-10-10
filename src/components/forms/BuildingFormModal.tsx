"use client";

// Form shown right after a sub-admin finishes tracing a building's footprint
// on the project's master plan (see PolygonTracer / the dashboard's
// project-detail tracer). Deliberately minimal — name, description, and how
// many floors it has (used only to pre-fill the "add floor" numbering hint,
// not enforced) — since the real per-floor detail is added afterward in the
// building's own management page.
import { useState } from "react";
import { createBuilding } from "@/lib/actions/buildings";
import type { PolygonPoint } from "@/lib/types";

export function BuildingFormModal({
  projectId,
  polygonPoints,
  onClose,
  onSaved,
}: {
  projectId: string;
  polygonPoints: PolygonPoint[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [totalFloors, setTotalFloors] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const result = await createBuilding(projectId, {
      name,
      description: description || null,
      total_floors: totalFloors ? Number(totalFloors) : null,
      polygon_points: polygonPoints,
    });

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
        className="w-full max-w-md space-y-3 rounded-lg bg-white p-6 shadow-xl dark:bg-gray-900"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">New building</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>

        <label className="block text-sm">
          Building name
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Tower A"
            className="mt-1 w-full rounded-md border border-gray-300 p-2 dark:border-gray-700 dark:bg-gray-800"
          />
        </label>

        <label className="block text-sm">
          Description
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-md border border-gray-300 p-2 dark:border-gray-700 dark:bg-gray-800"
          />
        </label>

        <label className="block text-sm">
          Total floors (approx.)
          <input
            type="number"
            value={totalFloors}
            onChange={(e) => setTotalFloors(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 p-2 dark:border-gray-700 dark:bg-gray-800"
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-60 dark:bg-white dark:text-gray-900"
          >
            {saving ? "Saving…" : "Save building"}
          </button>
        </div>
      </form>
    </div>
  );
}
