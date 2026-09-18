"use server";

// Server Actions for a sub-admin managing their own project(s): creating a
// project (with its master site-plan image) and editing its basic details.
// Row Level Security (see the init_schema migration) is the real
// authorization boundary here — these actions just shape the request; if a
// sub-admin somehow calls updateProject on a project they don't own, the
// update simply affects zero rows.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { uploadPlanImageFile } from "@/lib/uploadPlanImage";
import type { MapBounds } from "@/lib/types";
import type { ActionResult } from "./auth";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export async function createProject(formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const location = String(formData.get("location") ?? "").trim() || null;
  const developerName = String(formData.get("developer_name") ?? "").trim() || null;
  const planImage = formData.get("plan_image");

  if (!name) return { error: "Project name is required." };

  // Slugs must be globally unique (see the `unique` constraint on
  // projects.slug); appending a short random suffix keeps two sub-admins
  // from colliding on e.g. "green-valley" without asking them to pick a
  // slug by hand.
  const slug = `${slugify(name)}-${Math.random().toString(36).slice(2, 7)}`;

  let planImageUrl: string | null = null;
  if (planImage instanceof File && planImage.size > 0) {
    const result = await uploadPlanImageFile(supabase, user.id, planImage);
    if (result.error) return { error: `Plan image upload failed: ${result.error}` };
    planImageUrl = result.url!;
  }

  const { data: project, error } = await supabase
    .from("projects")
    .insert({
      sub_admin_id: user.id,
      name,
      slug,
      description,
      location,
      developer_name: developerName,
      plan_image_url: planImageUrl,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  revalidatePath("/dashboard");
  redirect(`/dashboard/projects/${project.id}`);
}

export async function updateProject(projectId: string, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const location = String(formData.get("location") ?? "").trim() || null;
  const developerName = String(formData.get("developer_name") ?? "").trim() || null;
  const contactPhone = String(formData.get("contact_phone") ?? "").trim() || null;
  const contactWhatsapp = String(formData.get("contact_whatsapp") ?? "").trim() || null;
  const contactEmail = String(formData.get("contact_email") ?? "").trim() || null;

  const { error } = await supabase
    .from("projects")
    .update({
      name,
      description,
      location,
      developer_name: developerName,
      contact_phone: contactPhone,
      contact_whatsapp: contactWhatsapp,
      contact_email: contactEmail,
    })
    .eq("id", projectId);

  if (error) return { error: error.message };

  revalidatePath(`/dashboard/projects/${projectId}`);
  return {};
}

// A project only shows up on the public homepage / /projects/[slug] once
// published — this lets a sub-admin finish tracing plots/buildings/flats
// privately before going live.
export async function setProjectStatus(projectId: string, status: "draft" | "published"): Promise<ActionResult> {
  const supabase = await createClient();

  const { error } = await supabase.from("projects").update({ status }).eq("id", projectId);
  if (error) return { error: error.message };

  revalidatePath(`/dashboard/projects/${projectId}`);
  revalidatePath("/", "layout");
  return {};
}

// Separate from createProject because a sub-admin can also add/replace the
// plan image later (e.g. they created the project before the final plan
// was ready).
export async function uploadPlanImage(projectId: string, file: File): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  const result = await uploadPlanImageFile(supabase, user.id, file);
  if (result.error) return { error: result.error };

  const { error } = await supabase
    .from("projects")
    .update({ plan_image_url: result.url })
    .eq("id", projectId);
  if (error) return { error: error.message };

  revalidatePath(`/dashboard/projects/${projectId}`);
  return {};
}

// Saves the satellite alignment a sub-admin sets up in SatelliteLayoutEditor
// (drag the plan image's two corners onto real satellite imagery). Setting
// this switches both the sub-admin's tracer and every viewer's map over to
// the satellite-based rendering; it's what lib/geo.ts projects each
// building/unit's existing fractional polygon into for lat/lng rendering.
export async function updateMapBounds(projectId: string, bounds: MapBounds): Promise<ActionResult> {
  const supabase = await createClient();

  const { error } = await supabase.from("projects").update({ map_bounds: bounds }).eq("id", projectId);
  if (error) return { error: error.message };

  revalidatePath(`/dashboard/projects/${projectId}`);
  revalidatePath("/projects", "layout");
  return {};
}
