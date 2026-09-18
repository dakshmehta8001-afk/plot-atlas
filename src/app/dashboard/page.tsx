// Sub-admin's own project list. RLS's public-read policy on projects would
// happily return everyone's projects, so this explicitly filters to
// sub_admin_id = current user rather than relying on RLS to narrow it —
// RLS here is a safety net (a viewer/other sub-admin can't ever forge this
// filter to write to a project that isn't theirs), not the only guard.
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
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

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Your projects</h1>
        <Link
          href="/dashboard/projects/new"
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900"
        >
          + New project
        </Link>
      </div>

      {!projects || projects.length === 0 ? (
        <p className="text-gray-500">You haven&apos;t created a project yet.</p>
      ) : (
        <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
          {(projects as Project[]).map((project) => (
            <li key={project.id} className="flex items-center justify-between p-4">
              <div>
                <p className="font-medium">
                  {project.name}{" "}
                  <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs capitalize text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                    {project.status}
                  </span>
                </p>
                <p className="text-sm text-gray-500">{project.location ?? "No location set"}</p>
              </div>
              <div className="flex gap-3 text-sm">
                <Link href={`/dashboard/projects/${project.id}`} className="underline">
                  Manage
                </Link>
                <Link href={`/dashboard/projects/${project.id}/leads`} className="underline">
                  Leads
                </Link>
                <Link href={`/projects/${project.slug}`} className="underline">
                  View live
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
