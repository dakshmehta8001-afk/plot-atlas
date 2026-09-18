// All projects platform-wide, with the owning sub-admin's name/email so an
// admin can trace a project back to who manages it.
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function AdminProjectsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select("id, name, slug, location, status, created_at, users(name, email)")
    .order("created_at", { ascending: false });

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">All projects</h1>
      {!data || data.length === 0 ? (
        <p className="text-gray-500">No projects yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th className="p-3">Project</th>
                <th className="p-3">Status</th>
                <th className="p-3">Location</th>
                <th className="p-3">Sub-admin</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
              {data.map((project) => {
                const owner = Array.isArray(project.users) ? project.users[0] : project.users;
                return (
                  <tr key={project.id}>
                    <td className="p-3 font-medium">{project.name}</td>
                    <td className="p-3 capitalize">{project.status}</td>
                    <td className="p-3">{project.location ?? "—"}</td>
                    <td className="p-3">{owner?.name ?? owner?.email ?? "—"}</td>
                    <td className="p-3">
                      <Link href={`/projects/${project.slug}`} className="underline">
                        View live
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
