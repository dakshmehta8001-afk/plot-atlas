"use server";

// Server Actions restricted to the admin role (enforced by RLS, not just the
// proxy's route gate): approving/rejecting sub-admin signups, and admin-level
// oversight of leads across every project on the platform.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./auth";
import type { UserStatus } from "@/lib/types";

export async function setSubAdminStatus(userId: string, status: UserStatus): Promise<ActionResult> {
  const supabase = await createClient();

  const { error } = await supabase.from("users").update({ status }).eq("id", userId);
  if (error) return { error: error.message };

  // A rejected sub-admin's projects go offline. RLS already stops them from
  // editing (owner writes need an active sub-admin), but their published
  // projects would otherwise stay public. This runs with the admin's own
  // session, so it goes through projects_modify_admin. Approving them again
  // does not republish anything; they publish again themselves.
  if (status === "rejected") {
    const { error: draftError } = await supabase
      .from("projects")
      .update({ status: "draft" })
      .eq("sub_admin_id", userId)
      .eq("status", "published");
    if (draftError) return { error: `Sub-admin rejected, but their projects could not be set to draft: ${draftError.message}` };
    revalidatePath("/", "layout");
  }

  revalidatePath("/admin/sub-admins");
  return {};
}
