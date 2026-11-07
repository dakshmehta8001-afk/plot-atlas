// "Media" tab content for a project's public page: a gallery grid of
// whatever images/videos the sub-admin uploaded via MediaManager, on the
// same paper panel as the About tab.
import type { ProjectMedia } from "@/lib/types";

export function MediaPanel({ media }: { media: ProjectMedia[] }) {
  return (
    <div className="flex h-full w-full items-start justify-center overflow-y-auto px-4 pb-28 pt-6 sm:items-center">
      <section
        aria-label="Project media"
        className="theme-survey w-full max-w-2xl border-2 border-[var(--ink)] bg-white text-[var(--ink)] shadow-[var(--hard)]"
      >
        <header className="flex items-baseline justify-between gap-3 border-b-2 border-[var(--ink)] px-4 py-3">
          <h2 className="font-label text-[12px] font-semibold uppercase tracking-[0.1em]">Media</h2>
          <span className="font-label text-[12px] tabular-nums text-[var(--ink-3)]">{media.length} items</span>
        </header>
        {media.length === 0 ? (
          <p className="p-4 text-sm text-[var(--ink-2)]">No photos or videos have been uploaded for this project yet.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 p-4 min-[480px]:grid-cols-2">
            {media.map((item) =>
              item.media_type === "video" ? (
                <video key={item.id} src={item.media_url} controls className="aspect-video w-full border border-[var(--line)] object-cover" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- gallery media comes from Supabase Storage
                <img key={item.id} src={item.media_url} alt={item.caption ?? ""} className="aspect-video w-full border border-[var(--line)] object-cover" />
              ),
            )}
          </div>
        )}
      </section>
    </div>
  );
}
