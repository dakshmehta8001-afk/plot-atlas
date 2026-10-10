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
import { uploadPlanImageFile } from "@/lib/image/uploadPlanImage";
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
  let planImageWidth: number | null = null;
  let planImageHeight: number | null = null;
  if (planImage instanceof File && planImage.size > 0) {
    const result = await uploadPlanImageFile(supabase, user.id, planImage);
    if (result.error) return { error: `Plan image upload failed: ${result.error}` };
    planImageUrl = result.url!;
    planImageWidth = result.width ?? null;
    planImageHeight = result.height ?? null;
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
      plan_image_width: planImageWidth,
      plan_image_height: planImageHeight,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };
  if (!project) return { error: "Project could not be created." };

  revalidatePath("/dashboard");
  // Straight into auto-digitize when a plan image came with the project —
  // the sub-admin just picked that file once; landing on the plain project
  // page first, with a SEPARATE "Auto-digitize a plan" prompt to click
  // through, asked them to notice and act on that prompt before detection
  // could run at all. No image yet (planImageUrl still null) falls back to
  // the ordinary project page, where PlanImageUpload covers adding one
  // later — same redirect-into-digitize happens there too.
  redirect(planImageUrl ? `/dashboard/projects/${project.id}/digitize` : `/dashboard/projects/${project.id}`);
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
      return { error: "Set the map scale first — use the Set scale button above the map, then publish." };
    }

    const { data: unsized, error: countError } = await supabase
      .from("units")
      .select("unit_number")
      .eq("project_id", projectId)
      .eq("needs_dimension_review", true);
    if (countError) return { error: countError.message };
    const count = unsized?.length ?? 0;
    if (count > 0) {
      // Name the plots, so the sub-admin knows which ones to open and give a size.
      const names = unsized!.map((u) => u.unit_number || "(no number)").slice(0, 12).join(", ");
      return {
        error: `${count} plot${count === 1 ? "" : "s"} still need${count === 1 ? "s" : ""} a size before publishing: ${names}${count > 12 ? "…" : ""}. Click each on the map and enter its size.`,
      };
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
    // A replaced image gets its new size too (null if it could not be read:
    // the map then falls back to measuring the image in the browser).
    .update({ plan_image_url: result.url, plan_image_width: result.width ?? null, plan_image_height: result.height ?? null })
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
// The project page's own "Set scale" button. The digitize screen recomputes
// plot sizes in the browser and saves them with the shapes; on the project
// page the plots are already saved, so the new scale and every plot's
// recomputed size (computed client-side with the same computeDimensionFields
// helper) are written here together. Without this, a project saved before
// setting a scale had no way to set one at all once the auto-digitize
// banner was removed — Publish stayed blocked.
export interface PlotSizeUpdate {
  id: string;
  dimensions: string | null;
  areaSqft: number | null;
  needsDimensionReview: boolean;
}

export async function calibrateProjectFromPlan(
  projectId: string,
  calibration: MapCalibration,
  plotSizes: PlotSizeUpdate[],
): Promise<ActionResult> {
  if (!(calibration.realDistanceFt > 0) || !Number.isFinite(calibration.realDistanceFt)) {
    return { error: "Enter a real distance greater than 0 ft." };
  }
  const supabase = await createClient();

  const { error } = await supabase.from("projects").update({ map_calibration: calibration }).eq("id", projectId);
  if (error) return { error: error.message };

  // Scoped by project_id too, so a forged id can't touch another project's
  // plot (RLS already limits writes to the owner's own projects).
  const results = await Promise.all(
    plotSizes.map((p) =>
      supabase
        .from("units")
        .update({
          dimensions: p.dimensions,
          area_sqft: p.areaSqft !== null && Number.isFinite(p.areaSqft) ? Math.round(p.areaSqft) : null,
          needs_dimension_review: p.needsDimensionReview,
        })
        .eq("id", p.id)
        .eq("project_id", projectId),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return { error: `Scale saved, but updating plot sizes failed: ${failed.error.message}` };

  revalidatePath(`/dashboard/projects/${projectId}`);
  return {};
}

export async function setProjectCalibration(projectId: string, calibration: MapCalibration): Promise<ActionResult> {
  const supabase = await createClient();

  const { error } = await supabase.from("projects").update({ map_calibration: calibration }).eq("id", projectId);
  if (error) return { error: error.message };

  revalidatePath(`/dashboard/projects/${projectId}`);
  return {};
}
