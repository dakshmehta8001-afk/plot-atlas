// Admin overview: a few platform-wide counts, and a shortlist of sub-admins
// awaiting approval so the most time-sensitive action isn't buried in the
// full sub-admins table.
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Section, EmptyState, card } from "@/components/dashboard/PageHeader";

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
      <PageHeader title="Overview" subtitle="Platform activity at a glance" />

      <div className="mb-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Sub-admins", value: subAdminCount ?? 0 },
          { label: "Pending approval", value: pendingCount ?? 0, alert: (pendingCount ?? 0) > 0 },
          { label: "Projects", value: projectCount ?? 0 },
          { label: "Leads, all time", value: leadCount ?? 0 },
        ].map((stat) => (
          <div
            key={stat.label}
            className={`rounded-2xl border p-4 sm:p-5 ${stat.alert ? "border-amber-500/30 bg-amber-500/5" : "border-white/10 bg-white/[0.03]"}`}
          >
            <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40">{stat.label}</p>
            <p className={`mt-1 text-3xl font-bold tabular-nums ${stat.alert ? "text-amber-300" : "text-white"}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      <Section title="Awaiting approval">
        {pending && pending.length > 0 ? (
          <ul className={`${card} divide-y divide-white/5 overflow-hidden`}>
            {pending.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 p-4 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-white">{p.name ?? p.email}</p>
                  <p className="truncate text-xs text-white/45">{p.email}</p>
                </div>
                <Link href="/admin/sub-admins" className="shrink-0 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/15">
                  Review
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Nothing waiting" body="New sub-admin requests appear here for review." />
        )}
      </Section>
    </div>
  );
}
