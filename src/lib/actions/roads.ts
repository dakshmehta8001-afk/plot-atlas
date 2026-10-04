"use server";

// Server Actions for a project's roads: tracing one as an open polyline
// (see PolygonTracer's "line" shape kind) along a road's centerline on the
// master site-plan image, labeled with its width.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./auth";
import type { PolygonPoint } from "@/lib/types";

export async function createRoad(
  projectId: string,
  widthLabel: string,
  pathPoints: PolygonPoint[],
): Promise<ActionResult> {
  const supabase = await createClient();

  const { error } = await supabase.from("roads").insert({
    project_id: projectId,
    width_label: widthLabel,
    path_points: pathPoints,
  });

  if (error) return { error: error.message };

  revalidatePath(`/dashboard/projects/${projectId}`);
  revalidatePath("/projects", "layout");
  return {};
}

export async function deleteRoad(roadId: string, projectId: string): Promise<ActionResult> {
  const supabase = await createClient();

  const { error } = await supabase.from("roads").delete().eq("id", roadId);
  if (error) return { error: error.message };

  revalidatePath(`/dashboard/projects/${projectId}`);
  revalidatePath("/projects", "layout");
  return {};
}

// Sets a road's width label (e.g. "30 ft"). Used by the dashboard road list to
// fix roads that have no width, so the public map can label them.
export async function updateRoadWidth(roadId: string, projectId: string, widthLabel: string): Promise<ActionResult> {
  const label = widthLabel.trim();
  if (!/\d/.test(label) || label.length > 20) return { error: "Choose a width with a number, like 30 ft." };
  const supabase = await createClient();

  const { error } = await supabase.from("roads").update({ width_label: label }).eq("id", roadId).eq("project_id", projectId);
  if (error) return { error: error.message };

  revalidatePath(`/dashboard/projects/${projectId}`);
  revalidatePath("/projects", "layout");
  return {};
}
