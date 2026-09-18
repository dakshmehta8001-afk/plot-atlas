"use server";

// Server Actions for a sub-admin scheduling and tracking site visits against
// a lead — covers "the sub-admin should see all visits" from the spec.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./auth";
import type { SiteVisitStatus } from "@/lib/types";

export async function scheduleSiteVisit(
  leadId: string,
  scheduledAt: string,
  notes: string | null,
): Promise<ActionResult> {
  const supabase = await createClient();

  const { error } = await supabase.from("site_visits").insert({
    lead_id: leadId,
    scheduled_at: scheduledAt,
    notes,
  });
  if (error) return { error: error.message };

  await supabase.from("leads").update({ status: "visit_scheduled" }).eq("id", leadId);

  revalidatePath("/dashboard", "layout");
  return {};
}

export async function updateSiteVisitStatus(visitId: string, status: SiteVisitStatus): Promise<ActionResult> {
  const supabase = await createClient();

  const { error } = await supabase.from("site_visits").update({ status }).eq("id", visitId);
  if (error) return { error: error.message };

  revalidatePath("/dashboard", "layout");
  return {};
}
