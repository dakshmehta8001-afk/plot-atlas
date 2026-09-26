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
import type { MapBounds, MapCalibration } from "@/lib/types";
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
  if (!project) return { error: "Project could not be created." };

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
//
// Going TO "published" is gated on two things, both checked here (the sole
// draft -> published transition point) rather than at the DB layer, since
// it's a business rule about data COMPLETENESS, not a structural
// constraint a CHECK/trigger could express cleanly: (1) the project has a
// real-world scale reference (map_calibration set — mandatory, per the
// user's explicit decision, not just recommended), and (2) zero of its
// plots still have needs_dimension_review = true. Going TO "draft" (or an
// ALREADY-published project) never runs this check — an old project that
// predates this feature entirely (map_calibration null, every plot's
// needs_dimension_review defaulted false by the migration) stays exactly
// as published as it already was; it would only need calibrating if
// someone unpublished and tried to republish it later.
export async function setProjectStatus(projectId: string, status: "draft" | "published"): Promise<ActionResult> {
  const supabase = await createClient();

  if (status === "published") {
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("map_calibration")
      .eq("id", projectId)
      .single();
    if (projectError) return { error: projectError.message };
    if (!project?.map_calibration) {
      return { error: "Set a scale reference (calibrate the map) before publishing." };
    }

    const { count, error: countError } = await supabase
      .from("units")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("needs_dimension_review", true);
    if (countError) return { error: countError.message };
    if (count && count > 0) {
      return { error: `${count} plot${count === 1 ? "" : "s"} still need${count === 1 ? "s" : ""} dimensions confirmed before publishing.` };
    }
  }

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

// Saves the one-time real-world scale reference a sub-admin sets by
// clicking two points a known distance apart during digitize review (see
// src/lib/calibration.ts for the math this then unlocks — every plot's
// exact dimensions/area are computed from it, and setProjectStatus below
// refuses to publish until it exists). Same shape as updateMapBounds
// above: a plain update, RLS-gated by ownership, not a bulk digitize save.
export async function setProjectCalibration(projectId: string, calibration: MapCalibration): Promise<ActionResult> {
  const supabase = await createClient();

  const { error } = await supabase.from("projects").update({ map_calibration: calibration }).eq("id", projectId);
  if (error) return { error: error.message };

  revalidatePath(`/dashboard/projects/${projectId}`);
  return {};
}
