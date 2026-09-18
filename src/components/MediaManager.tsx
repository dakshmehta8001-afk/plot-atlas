"use client";

// Dashboard-side gallery uploader for a project (feeds MediaPanel on the
// public page). Kept as a simple grid + file input rather than drag-and-
// drop, since a sub-admin uploading a handful of brochure photos doesn't
// need more than that.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { uploadProjectMedia, deleteProjectMedia } from "@/lib/actions/media";
import type { ProjectMedia } from "@/lib/types";

export function MediaManager({ projectId, media }: { projectId: string; media: ProjectMedia[] }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    const result = await uploadProjectMedia(projectId, file);
    setUploading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  async function handleDelete(id: string) {
    await deleteProjectMedia(id, projectId);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <input type="file" accept="image/*,video/*" onChange={handleUpload} disabled={uploading} className="text-sm" />
      {uploading && <p className="text-sm text-gray-500">Uploading…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {media.map((item) => (
          <div key={item.id} className="group relative aspect-video overflow-hidden rounded-md border border-gray-200 dark:border-gray-800">
            {item.media_type === "video" ? (
              <video src={item.media_url} className="h-full w-full object-cover" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- gallery media comes from Supabase Storage
              <img src={item.media_url} alt="" className="h-full w-full object-cover" />
            )}
            <button
              onClick={() => handleDelete(item.id)}
              className="absolute right-1 top-1 hidden rounded-full bg-black/60 px-1.5 py-0.5 text-xs text-white group-hover:block"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
