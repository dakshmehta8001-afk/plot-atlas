"use server";

// Server Actions for a building's floors. Each floor gets its own plate
// layout image (uploaded here) that flats on that floor are traced against —
// separate from the project's master site-plan image that plots and building
// footprints are traced against.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
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
  const planImage = formData.get("plan_image");

  if (Number.isNaN(floorNumber)) return { error: "Floor number is required." };

  let planImageUrl: string | null = null;
  if (planImage instanceof File && planImage.size > 0) {
    const path = `${user.id}/${Date.now()}-${planImage.name}`;
    const { error: uploadError } = await supabase.storage
      .from("plan-images")
      .upload(path, planImage, { contentType: planImage.type });
    if (uploadError) return { error: `Floor plan upload failed: ${uploadError.message}` };

    const { data: publicUrl } = supabase.storage.from("plan-images").getPublicUrl(path);
    planImageUrl = publicUrl.publicUrl;
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
