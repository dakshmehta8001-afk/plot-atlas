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
import Link from "next/link";
import { PageHeader, btnPrimary, btnSecondary } from "@/components/dashboard/PageHeader";

const inputCls =
  "w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2.5 text-sm text-white shadow-inner transition-colors placeholder:text-white/25 focus:border-white/30 focus:outline-none";

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between text-[11px] font-semibold uppercase tracking-wider text-white/45">
        <span>
          {label}
          {required && <span className="ml-0.5 text-red-400">*</span>}
        </span>
        {hint && <span className="font-normal normal-case tracking-normal text-white/30">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

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
    <div className="mx-auto w-full max-w-xl">
      <PageHeader
        crumbs={[{ label: "Projects", href: "/dashboard" }, { label: "New project" }]}
        title="New project"
        subtitle="Upload the site plan now and plots are detected automatically on the next screen."
      />
      <form action={handleSubmit} className="space-y-5 rounded-2xl border border-white/10 bg-[var(--map-panel)] p-5 sm:p-7">
        <Field label="Project name" required>
          <input name="name" required className={inputCls} placeholder="Green Valley Phase 2" />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Developer name">
            <input name="developer_name" className={inputCls} />
          </Field>
          <Field label="Location">
            <input name="location" className={inputCls} placeholder="City, area" />
          </Field>
        </div>
        <Field label="Description">
          <textarea name="description" rows={3} className={`${inputCls} resize-none`} />
        </Field>
        <Field label="Site plan" hint="Image or PDF">
          <input
            name="plan_image"
            type="file"
            accept={ACCEPT["plan-images"]}
            className="w-full rounded-xl border border-dashed border-white/15 bg-black/20 p-4 text-sm text-white/60 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:border-white/30"
          />
        </Field>
        {error && <p className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
        <div className="flex items-center justify-end gap-2 border-t border-white/10 pt-5">
          <Link href="/dashboard" className={btnSecondary}>
            Cancel
          </Link>
          <button type="submit" disabled={submitting} className={btnPrimary}>
            {submitting ? "Creating…" : "Create project"}
          </button>
        </div>
      </form>
    </div>
  );
}
