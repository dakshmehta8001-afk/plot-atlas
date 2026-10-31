// Create-project form. Uploads the plan image from the browser straight to
// Supabase Storage (bypassing Vercel's 4.5 MB request body cap), then sends
// only the storage path — not the file bytes — to the createProject server
// action. If createProject fails, the uploaded file is removed from Storage
// so it doesn't accumulate orphaned files.
"use client";

import { useState } from "react";
import { createProject } from "@/lib/actions/projects";
import { uploadFromBrowser } from "@/lib/storage/uploadFromBrowser";
import { renderPdfFirstPageToCanvas } from "@/lib/digitize/pdfToImageClient";
import { createClient } from "@/lib/supabase/client";
import { ACCEPT } from "@/lib/storage/limits";

// Converts a canvas to a PNG Blob (canvas.toBlob is callback-based).
function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error("Could not export the PDF page as an image."));
      else resolve(blob);
    }, "image/png");
  });
}

export default function NewProjectPage() {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(formData: FormData) {
    setSubmitting(true);
    setError(null);

    // Upload the plan image first, from the browser.
    let uploadedPath: string | null = null;
    const planImageFile = formData.get("plan_image");

    if (planImageFile instanceof File && planImageFile.size > 0) {
      let blob: Blob = planImageFile;
      let filename = planImageFile.name;

      // PDF: render the first page to a PNG blob client-side before upload,
      // so Storage only ever holds image/png (not application/pdf).
      if (planImageFile.type === "application/pdf" || filename.toLowerCase().endsWith(".pdf")) {
        try {
          const { canvas } = await renderPdfFirstPageToCanvas(planImageFile);
          blob = await canvasToBlob(canvas);
          filename = filename.replace(/\.pdf$/i, ".png");
        } catch (err) {
          setSubmitting(false);
          setError(`Could not convert that PDF: ${err instanceof Error ? err.message : "unknown error"}`);
          return;
        }
      }

      const uploadResult = await uploadFromBrowser("plan-images", blob, filename);
      if ("error" in uploadResult) {
        setSubmitting(false);
        setError(uploadResult.error);
        return;
      }
      uploadedPath = uploadResult.path;

      // Replace the file in the form data with the storage path and dimensions.
      formData.delete("plan_image");
      formData.set("plan_image_path", uploadResult.path);
      if (uploadResult.width) formData.set("plan_image_width", String(uploadResult.width));
      if (uploadResult.height) formData.set("plan_image_height", String(uploadResult.height));
    } else {
      formData.delete("plan_image");
    }

    const result = await createProject(formData);
    setSubmitting(false);

    if (result?.error) {
      setError(result.error);
      // Clean up the file that was just uploaded — the project doesn't exist
      // yet, so without this the file would sit in Storage with nothing
      // referencing it.
      if (uploadedPath) {
        const supabase = createClient();
        await supabase.storage.from("plan-images").remove([uploadedPath]);
      }
    }
    // On success, createProject redirects — control never reaches here.
  }

  return (
    <div className="mx-auto w-full max-w-lg">
      <h1 className="mb-6 text-2xl font-semibold">New project</h1>
      <form action={handleSubmit} className="space-y-3">
        <label className="block text-sm">
          Project name
          <input
            name="name"
            required
            className="mt-1 w-full rounded-md border border-gray-300 p-2 dark:border-gray-700 dark:bg-gray-900"
          />
        </label>
        <label className="block text-sm">
          Developer name
          <input
            name="developer_name"
            className="mt-1 w-full rounded-md border border-gray-300 p-2 dark:border-gray-700 dark:bg-gray-900"
          />
        </label>
        <label className="block text-sm">
          Location
          <input
            name="location"
            className="mt-1 w-full rounded-md border border-gray-300 p-2 dark:border-gray-700 dark:bg-gray-900"
          />
        </label>
        <label className="block text-sm">
          Description
          <textarea
            name="description"
            rows={3}
            className="mt-1 w-full rounded-md border border-gray-300 p-2 dark:border-gray-700 dark:bg-gray-900"
          />
        </label>
        <label className="block text-sm">
          Master site-plan image (image or PDF)
          <input name="plan_image" type="file" accept={ACCEPT["plan-images"]} className="mt-1 w-full text-sm" />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-60 dark:bg-white dark:text-gray-900"
        >
          {submitting ? "Creating…" : "Create project"}
        </button>
      </form>
    </div>
  );
}
