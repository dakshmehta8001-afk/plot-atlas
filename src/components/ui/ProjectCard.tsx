// One project on the public browse page: plan thumbnail, name, location.
import Link from "next/link";
import type { Project } from "@/lib/types";

// The location field is free text and sometimes holds a pasted Maps link.
export function displayLocation(location: string | null): string | null {
  if (!location) return null;
  const v = location.trim();
  return /^https?:\/\//i.test(v) ? null : v;
}

export function ProjectCard({ project, index = 0 }: { project: Project; index?: number }) {
  const location = displayLocation(project.location);
  return (
    <Link
      href={`/projects/${project.slug}`}
      className="group block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#030712] motion-safe:animate-[settleIn_420ms_var(--ease-cinematic)_backwards]"
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
    >
      <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-white/[0.08] bg-[var(--map-panel)]">
        {project.plan_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage thumbnail, not worth next/image optimisation
          <img
            src={project.plan_image_url}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover opacity-90 transition-transform duration-500 motion-safe:group-hover:scale-[1.03]"
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-xs text-white/30">No plan yet</div>
        )}
        <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/[0.04]" />
      </div>
      <div className="px-1 pt-3">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="truncate text-[15px] font-semibold text-white">{project.name}</h3>
          <span aria-hidden className="shrink-0 text-white/30 transition-transform motion-safe:group-hover:translate-x-0.5">
            →
          </span>
        </div>
        <p className="mt-0.5 truncate text-[13px] text-white/50">
          {[location, project.developer_name].filter(Boolean).join(" · ") || " "}
        </p>
      </div>
    </Link>
  );
}

export function ProjectCardSkeleton() {
  return (
    <div className="animate-pulse motion-reduce:animate-none">
      <div className="aspect-[4/3] rounded-2xl bg-white/[0.05]" />
      <div className="mt-3 h-4 w-2/3 rounded bg-white/[0.07]" />
      <div className="mt-2 h-3 w-1/3 rounded bg-white/[0.05]" />
    </div>
  );
}
