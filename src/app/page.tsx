// Public landing page: every viewer's entry point. Lists all published
// projects (public-read per RLS — no login needed to browse) with a simple
// text search. Search happens server-side via searchParams so the page
// works without JavaScript and is trivially shareable/bookmarkable as a URL.
import { createClient } from "@/lib/supabase/server";
import { ProjectCard } from "@/components/ProjectCard";
import type { Project } from "@/lib/types";

export default async function HomePage(props: PageProps<"/">) {
  const searchParams = await props.searchParams;
  const q = typeof searchParams.q === "string" ? searchParams.q : "";

  const supabase = await createClient();
  let query = supabase
    .from("projects")
    .select("*")
    .eq("status", "published")
    .order("created_at", { ascending: false });
  if (q) query = query.or(`name.ilike.%${q}%,location.ilike.%${q}%`);

  const { data: projects } = await query;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-semibold">Browse projects</h1>
      <p className="mb-6 text-gray-500">Explore plotted layouts and apartment societies, plot by plot and flat by flat.</p>

      <form className="mb-6 flex flex-wrap gap-2" method="get">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Search by name or location…"
          className="flex-1 rounded-md border border-gray-300 p-2 text-sm dark:border-gray-700 dark:bg-gray-900"
        />
        <button
          type="submit"
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900"
        >
          Search
        </button>
      </form>

      {!projects || projects.length === 0 ? (
        <p className="text-gray-500">No projects match your search yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {(projects as Project[]).map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </main>
  );
}
