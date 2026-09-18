"use client";

// Form for adding a floor to a building: floor number/name plus that
// floor's own plate layout image, which flats on it get traced against
// (separate from the project's master site-plan image).
import { useState } from "react";
import { createFloor } from "@/lib/actions/floors";

export function FloorFormModal({
  buildingId,
  projectId,
  onClose,
  onSaved,
}: {
  buildingId: string;
  projectId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(formData: FormData) {
    setSaving(true);
    setError(null);
    const result = await createFloor(buildingId, projectId, formData);
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
        action={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-3 rounded-lg bg-white p-6 shadow-xl dark:bg-gray-900"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Add floor</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            Floor number
            <input
              required
              type="number"
              name="floor_number"
              placeholder="0 = ground"
              className="mt-1 w-full rounded-md border border-gray-300 p-2 dark:border-gray-700 dark:bg-gray-800"
            />
          </label>
          <label className="block text-sm">
            Name (optional)
            <input
              name="name"
              placeholder="e.g. Ground Floor"
              className="mt-1 w-full rounded-md border border-gray-300 p-2 dark:border-gray-700 dark:bg-gray-800"
            />
          </label>
        </div>

        <label className="block text-sm">
          Floor plan image
          <input
            type="file"
            name="plan_image"
            accept="image/*"
            className="mt-1 w-full text-sm"
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-60 dark:bg-white dark:text-gray-900"
          >
            {saving ? "Saving…" : "Add floor"}
          </button>
        </div>
      </form>
    </div>
  );
}
