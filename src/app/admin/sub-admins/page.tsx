import { PageHeader } from "@/components/dashboard/PageHeader";
import { createClient } from "@/lib/supabase/server";
import { SubAdminsTable } from "@/components/dashboard/SubAdminsTable";
import type { AppUser } from "@/lib/types";

export default async function AdminSubAdminsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("users")
    .select("*")
    .eq("role", "sub_admin")
    .order("created_at", { ascending: false });

  return (
    <div>
      <PageHeader title="Sub-admins" subtitle="Approve or reject project owners" />
      <SubAdminsTable subAdmins={(data ?? []) as AppUser[]} />
    </div>
  );
}
