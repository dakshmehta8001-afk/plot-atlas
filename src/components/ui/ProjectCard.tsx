// Card summarizing one project on the public browse page. Plain server-
// renderable component (no interactivity of its own) — just a styled link.
import Link from "next/link";
import type { Project } from "@/lib/types";

export function ProjectCard({ project }: { project: Project }) {
  return (
    <Link
      href={`/projects/${project.slug}`}
      className="group block overflow-hidden rounded-3xl border border-white/10 bg-[var(--map-panel)] shadow-[0_4px_20px_rgba(0,0,0,0.3)] transition-all duration-300 hover:scale-[1.02] hover:border-white/20 hover:shadow-[0_8px_30px_rgba(255,255,255,0.1)] hover:bg-[var(--map-panel)]/80"
    >
      <div className="aspect-video bg-black/40 overflow-hidden relative border-b border-white/10">
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent z-10 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        {project.plan_image_url && (
          // eslint-disable-next-line @next/next/no-img-element -- plan images come from Supabase Storage, an external host we don't want to run through next/image optimization for a simple thumbnail crop
          <img src={project.plan_image_url} alt={project.name} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
        )}
      </div>
      <div className="p-6 relative z-20">
        <h3 className="font-bold text-xl text-white tracking-tight drop-shadow-sm">{project.name}</h3>
        {project.location && <p className="mt-1 text-sm text-white/60">{project.location}</p>}
        {project.developer_name && (
          <p className="mt-4 inline-block rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-blue-300/80 shadow-inner">{project.developer_name}</p>
        )}
      </div>
    </Link>
  );
}
