// Public landing page: every viewer's entry point. Lists all published
// projects (public-read per RLS — no login needed to browse) with a simple
// text search. Search happens server-side via searchParams so the page
// works without JavaScript and is trivially shareable/bookmarkable as a URL.
import { createClient } from "@/lib/supabase/server";
import { ProjectCard } from "@/components/ui/ProjectCard";
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
    <main className="mx-auto w-full max-w-6xl px-6 py-12">
      <div className="mb-10 text-center sm:text-left">
        <h1 className="mb-3 text-4xl font-extrabold tracking-tight text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.2)]">Browse projects</h1>
        <p className="text-lg text-white/60">Explore plotted layouts and apartment societies, plot by plot and flat by flat.</p>
      </div>

      <form className="mb-10 flex flex-col gap-3 sm:flex-row sm:items-center" method="get">
        <div className="relative flex-1">
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Search by name or location…"
            className="w-full rounded-2xl border border-white/10 bg-black/30 px-5 py-4 text-base text-white placeholder:text-white/30 shadow-inner transition-colors focus:border-white/30 focus:outline-none focus:ring-0"
          />
        </div>
        <button
          type="submit"
          className="rounded-2xl border border-white/10 bg-white px-8 py-4 text-base font-bold text-[#030712] shadow-[0_0_20px_rgba(255,255,255,0.2)] transition-all hover:scale-[1.02] hover:bg-white/90 hover:shadow-[0_0_25px_rgba(255,255,255,0.4)] active:scale-95"
        >
          Search
        </button>
      </form>

      {!projects || projects.length === 0 ? (
        <div className="rounded-3xl border border-white/10 bg-[var(--map-panel)] p-12 text-center shadow-inner">
          <p className="text-lg font-medium text-white/50">No projects match your search yet.</p>
        </div>
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
