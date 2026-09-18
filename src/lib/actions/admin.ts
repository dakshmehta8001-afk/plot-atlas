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

  revalidatePath("/admin/sub-admins");
  return {};
}
