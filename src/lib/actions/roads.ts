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
