// Sub-admin's leads + site-visits table for one project, with a basic
// status filter. Leads/site_visits/viewer profile access is all gated by
// RLS (see the "owners read project leads" policy) — this query just shapes
// what's fetched. unit_number is looked up manually rather than via a
// PostgREST embed since a lead's unit can be null (a general project
// enquiry, not tied to one plot/flat).
import { createClient } from "@/lib/supabase/server";
import { LeadsTable, type LeadRow } from "@/components/LeadsTable";
import { LEAD_STATUS_OPTIONS, type LeadStatus } from "@/lib/types";

export default async function ProjectLeadsPage(props: PageProps<"/dashboard/projects/[id]/leads">) {
  const { id } = await props.params;
  const searchParams = await props.searchParams;
  const statusFilter = typeof searchParams.status === "string" ? (searchParams.status as LeadStatus) : undefined;

  const supabase = await createClient();

  let query = supabase
    .from("leads")
    .select("id, message, status, created_at, name, email, unit_id, units(unit_number, wing), site_visits(*)")
    .eq("project_id", id)
    .order("created_at", { ascending: false });

  if (statusFilter) query = query.eq("status", statusFilter);

  const { data, error } = await query;

  const leads: LeadRow[] = (data ?? []).map((row) => {
    const unit = Array.isArray(row.units) ? row.units[0] : row.units;
    return {
      id: row.id,
      message: row.message,
      status: row.status,
      created_at: row.created_at,
      unit_label: unit ? `${unit.wing ? `${unit.wing}-` : ""}${unit.unit_number}` : "General enquiry",
      viewer_name: row.name,
      viewer_email: row.email,
      site_visits: row.site_visits ?? [],
    };
  });

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Leads &amp; site visits</h1>

      <form className="mb-4 flex gap-2" method="get">
        <select
          name="status"
          defaultValue={statusFilter ?? ""}
          className="rounded-md border border-gray-300 p-2 text-sm dark:border-gray-700 dark:bg-gray-900"
        >
          <option value="">All statuses</option>
          {LEAD_STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
        >
          Filter
        </button>
      </form>

      {error && <p className="text-sm text-red-600">{error.message}</p>}
      <LeadsTable leads={leads} editable />
    </div>
  );
}
