"use server";

// Server Actions for a building's floors. Each floor gets its own plate
// layout image (uploaded here) that flats on that floor are traced against —
// separate from the project's master site-plan image that plots and building
// footprints are traced against.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getValidatedPublicUrl } from "@/lib/storage/serverPaths";
import type { ActionResult } from "./auth";

export async function createFloor(
  buildingId: string,
  projectId: string,
  formData: FormData,
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  const floorNumber = Number(formData.get("floor_number"));
  const name = String(formData.get("name") ?? "").trim() || null;
  // The browser uploaded the plan image and sent back a storage path; the
  // file bytes never reach this server action.
  const planImagePath = String(formData.get("plan_image_path") ?? "").trim() || null;

  if (Number.isNaN(floorNumber)) return { error: "Floor number is required." };

  let planImageUrl: string | null = null;
  if (planImagePath) {
    const validated = getValidatedPublicUrl(supabase, "plan-images", planImagePath, user.id);
    if ("error" in validated) return { error: validated.error };
    planImageUrl = validated.url;
  }

  const { error } = await supabase.from("floors").insert({
    building_id: buildingId,
    floor_number: floorNumber,
    name,
    plan_image_url: planImageUrl,
  });

  if (error) return { error: error.message };

  revalidatePath(`/dashboard/projects/${projectId}/buildings/${buildingId}`);
  revalidatePath("/projects", "layout");
  return {};
}

export async function deleteFloor(floorId: string, buildingId: string, projectId: string): Promise<ActionResult> {
  const supabase = await createClient();

  const { error } = await supabase.from("floors").delete().eq("id", floorId);
  if (error) return { error: error.message };

  revalidatePath(`/dashboard/projects/${projectId}/buildings/${buildingId}`);
  revalidatePath("/projects", "layout");
  return {};
}
