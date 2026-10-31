"use client";

// Shown on a project's manage page when it has no plan image yet. Uploads
// straight from the browser to Supabase Storage (bypassing Vercel's 4.5 MB
// request body cap), then calls setPlanImage with only the storage path.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { setPlanImage } from "@/lib/actions/projects";
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

export function PlanImageUpload({ projectId }: { projectId: string }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);

    let blob: Blob = file;
    let filename = file.name;

    if (file.type === "application/pdf" || filename.toLowerCase().endsWith(".pdf")) {
      try {
        const { canvas } = await renderPdfFirstPageToCanvas(file);
        blob = await canvasToBlob(canvas);
        filename = filename.replace(/\.pdf$/i, ".png");
      } catch (err) {
        setUploading(false);
        setError(`Could not convert that PDF: ${err instanceof Error ? err.message : "unknown error"}`);
        return;
      }
    }

    const uploadResult = await uploadFromBrowser("plan-images", blob, filename);
    if ("error" in uploadResult) {
      setUploading(false);
      setError(uploadResult.error);
      return;
    }

    const result = await setPlanImage(projectId, {
      path: uploadResult.path,
      width: uploadResult.width,
      height: uploadResult.height,
    });
    setUploading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    // Into auto-digitize immediately, same as the new-project flow.
    router.push(`/dashboard/projects/${projectId}/digitize`);
  }

  return (
    <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center dark:border-gray-700">
      <p className="mb-3 text-sm text-gray-500">
        Upload a master site-plan image (or PDF) to start tracing plots and building footprints.
      </p>
      <input type="file" accept={ACCEPT["plan-images"]} onChange={handleChange} disabled={uploading} className="text-sm" />
      {uploading && <p className="mt-2 text-sm text-gray-500">Uploading…</p>}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
