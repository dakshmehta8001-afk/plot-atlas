import { createClient } from "@/lib/supabase/server";
import { SubAdminsTable } from "@/components/SubAdminsTable";
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
      <h1 className="mb-6 text-2xl font-semibold">Sub-admins</h1>
      <SubAdminsTable subAdmins={(data ?? []) as AppUser[]} />
    </div>
  );
}
