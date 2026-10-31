"use client";

// Form for adding a floor to a building. Uploads the floor plan image from
// the browser (PDF→PNG if needed) before calling createFloor, so Vercel's
// 4.5 MB request body cap doesn't apply to plan images.
import { useState } from "react";
import { createFloor } from "@/lib/actions/floors";
import { uploadFromBrowser } from "@/lib/storage/uploadFromBrowser";
import { renderPdfFirstPageToCanvas } from "@/lib/digitize/pdfToImageClient";
import { ACCEPT } from "@/lib/storage/limits";

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error("Could not export the PDF page as an image."));
      else resolve(blob);
    }, "image/png");
  });
}

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

    const file = formData.get("plan_image");
    if (file instanceof File && file.size > 0) {
      let blob: Blob = file;
      let filename = file.name;

      if (file.type === "application/pdf" || filename.toLowerCase().endsWith(".pdf")) {
        try {
          const { canvas } = await renderPdfFirstPageToCanvas(file);
          blob = await canvasToBlob(canvas);
          filename = filename.replace(/\.pdf$/i, ".png");
        } catch (err) {
          setSaving(false);
          setError(`Could not convert that PDF: ${err instanceof Error ? err.message : "unknown error"}`);
          return;
        }
      }

      const uploadResult = await uploadFromBrowser("plan-images", blob, filename);
      if ("error" in uploadResult) {
        setSaving(false);
        setError(uploadResult.error);
        return;
      }

      // Replace the file with the storage path so createFloor only receives
      // a path string, not the file bytes.
      formData.delete("plan_image");
      formData.set("plan_image_path", uploadResult.path);
    } else {
      formData.delete("plan_image");
    }

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
        // See UnitFormModal.tsx's comment on this same pattern.
        className="w-full max-w-md space-y-3 rounded-lg bg-white p-6 text-gray-900 shadow-xl dark:bg-gray-900 dark:text-gray-100"
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
          Floor plan image (image or PDF)
          <input
            type="file"
            name="plan_image"
            accept={ACCEPT["plan-images"]}
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
