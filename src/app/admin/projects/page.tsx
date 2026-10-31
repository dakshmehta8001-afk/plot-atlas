// All projects platform-wide, with the owning sub-admin's name/email so an
// admin can trace a project back to who manages it.
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState, card } from "@/components/dashboard/PageHeader";

export default async function AdminProjectsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select("id, name, slug, location, status, created_at, users(name, email)")
    .order("created_at", { ascending: false });

  const rows = (data ?? []).map((p) => ({
    ...p,
    owner: Array.isArray(p.users) ? p.users[0] : p.users,
    place: p.location && !p.location.startsWith("http") ? p.location : "—",
  }));

  return (
    <div>
      <PageHeader title="All projects" subtitle={rows.length ? `${rows.length} total` : undefined} />
      {rows.length === 0 ? (
        <EmptyState title="No projects yet" body="Projects created by sub-admins appear here." />
      ) : (
        <>
          <ul className="grid gap-2 sm:hidden">
            {rows.map((p) => (
              <li key={p.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate font-semibold text-white">{p.name}</p>
                  <Status status={p.status} />
                </div>
                <p className="mt-0.5 truncate text-xs text-white/45">
                  {p.owner?.name ?? p.owner?.email ?? "—"} · {p.place}
                </p>
                <Link href={`/projects/${p.slug}`} className="mt-2 inline-block text-xs font-medium text-white/70 hover:text-white">
                  View live →
                </Link>
              </li>
            ))}
          </ul>
          <div className={`${card} hidden overflow-x-auto sm:block`}>
            <table className="w-full text-left text-sm">
              <thead className="border-b border-white/10 text-[11px] uppercase tracking-wider text-white/40">
                <tr>
                  <th className="p-3 font-semibold">Project</th>
                  <th className="p-3 font-semibold">Status</th>
                  <th className="p-3 font-semibold">Location</th>
                  <th className="p-3 font-semibold">Sub-admin</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-white/75">
                {rows.map((p) => (
                  <tr key={p.id} className="transition-colors hover:bg-white/[0.03]">
                    <td className="p-3 font-medium text-white">{p.name}</td>
                    <td className="p-3"><Status status={p.status} /></td>
                    <td className="max-w-[16rem] truncate p-3">{p.place}</td>
                    <td className="p-3">{p.owner?.name ?? p.owner?.email ?? "—"}</td>
                    <td className="p-3 text-right">
                      <Link href={`/projects/${p.slug}`} className="text-white/60 hover:text-white">
                        View live →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Status({ status }: { status: string }) {
  const live = status === "published";
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
        live ? "border-green-500/30 bg-green-500/10 text-green-300" : "border-white/15 bg-white/5 text-white/50"
      }`}
    >
      {live ? "Live" : status}
    </span>
  );
}
