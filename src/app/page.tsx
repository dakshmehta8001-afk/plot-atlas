// Public landing page: lists published projects with server-side search via
// ?q= so results are shareable and work without JavaScript.
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ProjectCard, type ProjectStats } from "@/components/ui/ProjectCard";
import type { Project, UnitStatus } from "@/lib/types";

// Search only earns its place once there is something to search through.
const SEARCH_MIN_PROJECTS = 6;

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

  // Per-project availability and starting price for the cards. Only the four
  // columns needed are read. Note: PostgREST returns at most 1,000 rows per
  // request, so once a catalogue outgrows that this should become a database
  // view or RPC that aggregates per project.
  const stats = new Map<string, ProjectStats>();
  if (projects.length > 0) {
    const { data: unitRows } = await supabase
      .from("units")
      .select("project_id, unit_type, status, total_price")
      .in("project_id", projects.map((p) => p.id));
    const kinds = new Map<string, Set<string>>();
    for (const u of (unitRows ?? []) as { project_id: string; unit_type: string; status: UnitStatus; total_price: number | null }[]) {
      let st = stats.get(u.project_id);
      if (!st) {
        st = { total: 0, available: 0, hold: 0, booked: 0, sold: 0, fromPrice: null, noun: "units" };
        stats.set(u.project_id, st);
        kinds.set(u.project_id, new Set());
      }
      st.total += 1;
      st[u.status] += 1;
      kinds.get(u.project_id)!.add(u.unit_type);
      if (u.status === "available" && u.total_price !== null && (st.fromPrice === null || u.total_price < st.fromPrice)) {
        st.fromPrice = u.total_price;
      }
    }
    for (const [id, st] of stats) {
      const k = kinds.get(id)!;
      st.noun = k.size === 1 ? (k.has("plot") ? "plots" : k.has("flat") ? "flats" : "units") : "units";
    }
  }

  const showSearch = q !== "" || projects.length >= SEARCH_MIN_PROJECTS;

  return (
    <div className="theme-paper flex-1 bg-[var(--paper)] text-[var(--ink)]">
      <main className="mx-auto w-full max-w-6xl px-4 pb-20 pt-8 sm:px-6 sm:pt-14">
        <header className="mb-8 sm:mb-10">
          <h1 className="font-display text-[34px] leading-[1.1] tracking-tight sm:text-[44px]">Browse projects</h1>
          <p className="mt-2.5 max-w-xl text-[16px] leading-relaxed text-[var(--ink-2)]">
            Open a project, tap any plot, and see its size, facing and price.
          </p>
        </header>

        {showSearch && (
          <form method="get" role="search" className="mb-8">
            <label htmlFor="q" className="sr-only">
              Search projects
            </label>
            <div className="relative max-w-xl">
              <svg aria-hidden viewBox="0 0 20 20" fill="currentColor" className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-3)]">
                <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 3.4 9.83l3.13 3.14a.75.75 0 1 0 1.06-1.06l-3.13-3.14A5.5 5.5 0 0 0 9 3.5ZM5 9a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z" clipRule="evenodd" />
              </svg>
              <input
                id="q"
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Search by name or location"
                className="h-12 w-full rounded-full border border-[var(--line)] bg-white pl-11 pr-24 text-[15px] text-[var(--ink)] placeholder:text-[var(--ink-3)] transition-colors focus:border-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/25"
              />
              <button
                type="submit"
                className="absolute right-1.5 top-1/2 h-9 -translate-y-1/2 rounded-full bg-[var(--accent)] px-4 text-[13px] font-semibold text-[var(--accent-ink)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
              >
                Search
              </button>
            </div>
          </form>
        )}

        {q && (
          <p className="mb-4 text-[13px] text-[var(--ink-3)]">
            {projects.length} {projects.length === 1 ? "result" : "results"} for &ldquo;{q}&rdquo;
          </p>
        )}

        {projects.length === 0 ? (
          <div className="rounded-[20px] border border-dashed border-[var(--line)] px-6 py-16 text-center">
            <p className="text-[15px] font-medium text-[var(--ink-2)]">{q ? "No projects match your search" : "No projects published yet"}</p>
            {q && (
              <Link href="/" className="mt-3 inline-flex min-h-11 items-center text-[13px] text-[var(--accent)] underline underline-offset-4">
                Clear search
              </Link>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project, i) => (
              <ProjectCard key={project.id} project={project} stats={stats.get(project.id)} index={i} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
