// Platform-wide leads, across every project. Reuses the same LeadsTable as
// the sub-admin dashboard — the "admins read/update all leads" RLS policies
// are what actually make the wider dataset visible here.
import { createClient } from "@/lib/supabase/server";
import { LeadsTable, type LeadRow } from "@/components/LeadsTable";

export default async function AdminLeadsPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .select("id, message, status, created_at, name, email, units(unit_number, wing), site_visits(*)")
    .order("created_at", { ascending: false });

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
      <h1 className="mb-6 text-2xl font-semibold">All leads</h1>
      {error && <p className="text-sm text-red-600">{error.message}</p>}
      <LeadsTable leads={leads} editable />
    </div>
  );
}
