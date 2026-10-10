// "Media" tab content for a project's public page: a simple gallery grid of
// whatever images/videos the sub-admin uploaded via MediaManager.
import type { ProjectMedia } from "@/lib/types";

export function MediaPanel({ media }: { media: ProjectMedia[] }) {
  if (media.length === 0) {
    return (
      <div className="w-80 rounded-xl border border-white/10 bg-[#0f2436]/95 p-4 text-sm text-white/60 shadow-2xl backdrop-blur">
        No media uploaded yet.
      </div>
    );
  }

  return (
    <div className="grid max-h-80 w-80 grid-cols-2 gap-2 overflow-y-auto rounded-xl border border-white/10 bg-[#0f2436]/95 p-3 shadow-2xl backdrop-blur">
      {media.map((item) =>
        item.media_type === "video" ? (
          <video key={item.id} src={item.media_url} controls className="aspect-video w-full rounded-md object-cover" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- gallery media comes from Supabase Storage
          <img key={item.id} src={item.media_url} alt={item.caption ?? ""} className="aspect-video w-full rounded-md object-cover" />
        ),
      )}
    </div>
  );
}
