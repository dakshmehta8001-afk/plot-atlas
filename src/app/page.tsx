// Public landing page: lists published projects with server-side search via
// ?q= so results are shareable and work without JavaScript.
import Link from "next/link";
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
  if (q) {
    // Escape backslash first, then quotes, so PostgREST reads it as a literal.
    const safe = q.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    query = query.or(`name.ilike."%${safe}%",location.ilike."%${safe}%"`);
  }

  const { data } = await query;
  const projects = (data ?? []) as Project[];

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-8 sm:px-6 sm:pt-14">
      <header className="mb-6 sm:mb-10">
        <h1 className="text-[28px] font-bold leading-tight tracking-tight text-white sm:text-4xl">Projects</h1>
        <p className="mt-1.5 max-w-xl text-[15px] text-white/55">
          Explore plotted layouts and apartment societies, plot by plot.
        </p>
      </header>

      <form method="get" role="search" className="sticky top-14 z-10 -mx-4 mb-8 bg-[#030712]/80 px-4 py-3 backdrop-blur-xl sm:static sm:mx-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
        <label htmlFor="q" className="sr-only">
          Search projects
        </label>
        <div className="relative">
          <svg aria-hidden viewBox="0 0 20 20" fill="currentColor" className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35">
            <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 3.4 9.83l3.13 3.14a.75.75 0 1 0 1.06-1.06l-3.13-3.14A5.5 5.5 0 0 0 9 3.5ZM5 9a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z" clipRule="evenodd" />
          </svg>
          <input
            id="q"
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search by name or location"
            className="h-12 w-full rounded-full border border-white/10 bg-white/[0.04] pl-11 pr-24 text-[15px] text-white placeholder:text-white/35 transition-colors focus:border-white/25 focus:bg-white/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
          />
          <button
            type="submit"
            className="absolute right-1.5 top-1/2 h-9 -translate-y-1/2 rounded-full bg-white px-4 text-[13px] font-semibold text-[#030712] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            Search
          </button>
        </div>
      </form>

      {q && (
        <p className="mb-4 text-[13px] text-white/45">
          {projects.length} {projects.length === 1 ? "result" : "results"} for â€œ{q}â€
        </p>
      )}

      {projects.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 px-6 py-16 text-center">
          <p className="text-[15px] font-medium text-white/70">{q ? "No projects match your search" : "No projects published yet"}</p>
          {q && (
            <Link href="/" className="mt-3 inline-flex min-h-11 items-center text-[13px] text-white/50 underline-offset-4 hover:text-white hover:underline">
              Clear search
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project, i) => (
            <ProjectCard key={project.id} project={project} index={i} />
          ))}
        </div>
      )}
    </main>
  );
}
