"use server";

// Server Actions for a project's non-sellable site features (parks, temples,
// gates, clubhouses, common areas, water bodies) — traced as a closed
// polygon on the master site-plan image. Structurally identical to
// src/lib/actions/roads.ts; a separate file only because it's a different
// table with its own `kind` field, not because the pattern differs.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./auth";
import type { PolygonPoint, SiteFeatureKind } from "@/lib/types";

export async function createSiteFeature(
  projectId: string,
  kind: SiteFeatureKind,
  label: string,
  polygonPoints: PolygonPoint[],
): Promise<ActionResult> {
  const supabase = await createClient();

  const { error } = await supabase.from("site_features").insert({
    project_id: projectId,
    kind,
    label,
    polygon_points: polygonPoints,
  });

  if (error) return { error: error.message };

  revalidatePath(`/dashboard/projects/${projectId}`);
  revalidatePath("/projects", "layout");
  return {};
}

export async function updateSiteFeature(
  featureId: string,
  projectId: string,
  input: { kind?: SiteFeatureKind; label?: string; polygon_points?: PolygonPoint[] },
): Promise<ActionResult> {
  const supabase = await createClient();

  const { error } = await supabase.from("site_features").update(input).eq("id", featureId);
  if (error) return { error: error.message };

  revalidatePath(`/dashboard/projects/${projectId}`);
  revalidatePath("/projects", "layout");
  return {};
}

export async function deleteSiteFeature(featureId: string, projectId: string): Promise<ActionResult> {
  const supabase = await createClient();

  const { error } = await supabase.from("site_features").delete().eq("id", featureId);
  if (error) return { error: error.message };

  revalidatePath(`/dashboard/projects/${projectId}`);
  revalidatePath("/projects", "layout");
  return {};
}
