"use client";

// Small standalone uploader shown on a project's manage page when it has no
// plan image yet (a sub-admin can create the project before the final plan
// is ready, then add it here once they have it).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { uploadPlanImage } from "@/lib/actions/projects";

export function PlanImageUpload({ projectId }: { projectId: string }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    const result = await uploadPlanImage(projectId, file);
    setUploading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center dark:border-gray-700">
      <p className="mb-3 text-sm text-gray-500">
        Upload a master site-plan image to start tracing plots and building footprints.
      </p>
      <input type="file" accept="image/*" onChange={handleChange} disabled={uploading} className="text-sm" />
      {uploading && <p className="mt-2 text-sm text-gray-500">Uploading…</p>}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
