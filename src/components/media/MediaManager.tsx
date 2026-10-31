"use client";

// Dashboard gallery uploader for a project. Files go straight from the
// browser to Supabase Storage (uploadFromBrowser), so Vercel's 4.5 MB
// request body cap doesn't apply. The server action receives only the
// storage path and media type.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { uploadProjectMedia, deleteProjectMedia } from "@/lib/actions/media";
import { uploadFromBrowser } from "@/lib/storage/uploadFromBrowser";
import type { ProjectMedia } from "@/lib/types";
import { ACCEPT } from "@/lib/storage/limits";

export function MediaManager({ projectId, media }: { projectId: string; media: ProjectMedia[] }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);

    const uploadResult = await uploadFromBrowser("project-media", file, file.name);
    if ("error" in uploadResult) {
      setUploading(false);
      setError(uploadResult.error);
      return;
    }

    // Derive media type from the MIME type — the server also validates this.
    const mediaType = file.type.startsWith("video/") ? "video" : "image";
    const result = await uploadProjectMedia(projectId, { path: uploadResult.path, mediaType });
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
      <input type="file" accept={ACCEPT["project-media"]} onChange={handleUpload} disabled={uploading} className="text-sm" />
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
