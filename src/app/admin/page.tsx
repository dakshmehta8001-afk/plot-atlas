// Admin overview: a few platform-wide counts, and a shortlist of sub-admins
// awaiting approval so the most time-sensitive action isn't buried in the
// full sub-admins table.
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function AdminOverviewPage() {
  const supabase = await createClient();

  const [{ count: subAdminCount }, { count: pendingCount }, { count: projectCount }, { count: leadCount }, { data: pending }] =
    await Promise.all([
      supabase.from("users").select("*", { count: "exact", head: true }).eq("role", "sub_admin"),
      supabase.from("users").select("*", { count: "exact", head: true }).eq("role", "sub_admin").eq("status", "pending"),
      supabase.from("projects").select("*", { count: "exact", head: true }),
      supabase.from("leads").select("*", { count: "exact", head: true }),
      supabase.from("users").select("id, name, email, created_at").eq("role", "sub_admin").eq("status", "pending"),
    ]);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Overview</h1>

      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Sub-admins", value: subAdminCount ?? 0 },
          { label: "Pending approval", value: pendingCount ?? 0 },
          { label: "Projects", value: projectCount ?? 0 },
          { label: "Leads (all-time)", value: leadCount ?? 0 },
        ].map((stat) => (
          <div key={stat.label} className="rounded-lg border border-gray-200 p-4 dark:border-gray-800">
            <p className="text-2xl font-semibold">{stat.value}</p>
            <p className="text-sm text-gray-500">{stat.label}</p>
          </div>
        ))}
      </div>

      {pending && pending.length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-semibold">Awaiting approval</h2>
          <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
            {pending.map((p) => (
              <li key={p.id} className="flex items-center justify-between p-3 text-sm">
                <span>
                  {p.name ?? p.email} <span className="text-gray-500">({p.email})</span>
                </span>
                <Link href="/admin/sub-admins" className="underline">
                  Review
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
