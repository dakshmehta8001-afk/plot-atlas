// Sub-admin's own project list. RLS's public-read policy on projects would
// happily return everyone's projects, so this explicitly filters to
// sub_admin_id = current user rather than relying on RLS to narrow it —
// RLS here is a safety net (a viewer/other sub-admin can't ever forge this
// filter to write to a project that isn't theirs), not the only guard.
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState, btnPrimary, card } from "@/components/dashboard/PageHeader";
import type { Project } from "@/lib/types";

export default async function DashboardHomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: projects } = await supabase
    .from("projects")
    .select("*")
    .eq("sub_admin_id", user!.id)
    .order("created_at", { ascending: false });

  const list = (projects ?? []) as Project[];
  const newButton = (
    <Link href="/dashboard/projects/new" className={btnPrimary}>
      New project
    </Link>
  );

  return (
    <div>
      <PageHeader
        title="Your projects"
        subtitle={list.length ? `${list.length} project${list.length === 1 ? "" : "s"}` : undefined}
        actions={list.length ? newButton : undefined}
      />

      {list.length === 0 ? (
        <EmptyState
          title="No projects yet"
          body="Create a project, upload its site plan, and the plots are detected for you to review."
          action={newButton}
        />
      ) : (
        <ul className="grid gap-3">
          {list.map((project) => (
            <li key={project.id} className={`${card} group transition-colors hover:border-white/20`}>
              <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
                <Link href={`/dashboard/projects/${project.id}`} className="flex min-w-0 flex-1 items-center gap-4">
                  <div className="h-14 w-20 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-black/40">
                    {project.plan_image_url && (
                      // eslint-disable-next-line @next/next/no-img-element -- Supabase storage thumbnail
                      <img src={project.plan_image_url} alt="" className="h-full w-full object-cover opacity-80" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-semibold text-white">{project.name}</p>
                      <StatusPill status={project.status} />
                    </div>
                    <p className="mt-0.5 truncate text-sm text-white/45">
                      {project.location && !project.location.startsWith("http") ? project.location : "No location set"}
                    </p>
                  </div>
                </Link>
                <div className="flex gap-2 text-sm">
                  <Link href={`/dashboard/projects/${project.id}`} className="rounded-lg bg-white/10 px-3 py-1.5 font-medium text-white transition-colors hover:bg-white/15">
                    Manage
                  </Link>
                  <Link href={`/dashboard/projects/${project.id}/leads`} className="rounded-lg px-3 py-1.5 text-white/60 transition-colors hover:bg-white/5 hover:text-white">
                    Leads
                  </Link>
                  <Link href={`/projects/${project.slug}`} className="rounded-lg px-3 py-1.5 text-white/60 transition-colors hover:bg-white/5 hover:text-white">
                    View live
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const live = status === "published";
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
        live ? "border-green-500/30 bg-green-500/10 text-green-300" : "border-white/15 bg-white/5 text-white/50"
      }`}
    >
      {live ? "Live" : status}
    </span>
  );
}
