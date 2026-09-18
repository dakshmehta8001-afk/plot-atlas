// Card summarizing one project on the public browse page. Plain server-
// renderable component (no interactivity of its own) — just a styled link.
import Link from "next/link";
import type { Project } from "@/lib/types";

export function ProjectCard({ project }: { project: Project }) {
  return (
    <Link
      href={`/projects/${project.slug}`}
      className="block overflow-hidden rounded-lg border border-gray-200 shadow-sm transition hover:shadow-md dark:border-gray-800"
    >
      <div className="aspect-video bg-gray-100 dark:bg-gray-900">
        {project.plan_image_url && (
          // eslint-disable-next-line @next/next/no-img-element -- plan images come from Supabase Storage, an external host we don't want to run through next/image optimization for a simple thumbnail crop
          <img src={project.plan_image_url} alt={project.name} className="h-full w-full object-cover" />
        )}
      </div>
      <div className="p-4">
        <h3 className="font-semibold">{project.name}</h3>
        {project.location && <p className="text-sm text-gray-500">{project.location}</p>}
        {project.developer_name && (
          <p className="mt-1 text-xs uppercase tracking-wide text-gray-400">{project.developer_name}</p>
        )}
      </div>
    </Link>
  );
}
