"use server";

// Server Actions around leads (viewer enquiries): a signed-in viewer creating
// one via useEnquiryFlow, and a sub-admin/admin updating its status as they
// work it. RLS (see init_schema migration) restricts inserts to
// viewer_id = auth.uid() and reads/updates to the project's owning sub_admin
// or an admin.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./auth";
import type { LeadStatus } from "@/lib/types";

export async function createLead(unitId: string, message: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in to enquire." };

  const { data: unit, error: unitError } = await supabase
    .from("units")
    .select("project_id")
    .eq("id", unitId)
    .single();
  if (unitError || !unit) return { error: "That unit could not be found." };

  const { data: profile } = await supabase
    .from("users")
    .select("name, email, phone")
    .eq("id", user.id)
    .single();

  const { error } = await supabase.from("leads").insert({
    project_id: unit.project_id,
    unit_id: unitId,
    viewer_id: user.id,
    name: profile?.name ?? user.email ?? "Viewer",
    email: profile?.email ?? user.email,
    phone: profile?.phone ?? null,
    message: message || null,
  });

  if (error) return { error: error.message };

  revalidatePath("/dashboard", "layout");
  return {};
}

export async function updateLeadStatus(leadId: string, status: LeadStatus): Promise<ActionResult> {
  const supabase = await createClient();

  const { error } = await supabase.from("leads").update({ status }).eq("id", leadId);
  if (error) return { error: error.message };

  revalidatePath("/dashboard", "layout");
  revalidatePath("/admin", "layout");
  return {};
}
