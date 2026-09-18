"use server";

// Server Actions for a sub-admin's buildings: tracing a building's footprint
// as a polygon on the project's master site-plan image (same manual-tracing
// approach as a plot — see PolygonTracer.tsx), and editing/deleting it.
// Deleting a building cascades to its floors and flats (see the schema's
// `on delete cascade`), so the UI confirms before calling this.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./auth";
import type { PolygonPoint } from "@/lib/types";

export interface BuildingInput {
  name: string;
  description?: string | null;
  total_floors?: number | null;
  polygon_points: PolygonPoint[];
}

export async function createBuilding(projectId: string, input: BuildingInput): Promise<ActionResult> {
  const supabase = await createClient();

  const { error } = await supabase.from("buildings").insert({
    project_id: projectId,
    name: input.name,
    description: input.description ?? null,
    total_floors: input.total_floors ?? null,
    polygon_points: input.polygon_points,
  });

  if (error) return { error: error.message };

  revalidatePath(`/dashboard/projects/${projectId}`);
  revalidatePath("/projects", "layout");
  return {};
}

export interface BuildingUpdateInput {
  name?: string;
  description?: string | null;
  total_floors?: number | null;
  polygon_points?: PolygonPoint[];
}

export async function updateBuilding(
  buildingId: string,
  projectId: string,
  input: BuildingUpdateInput,
): Promise<ActionResult> {
  const supabase = await createClient();

  const { error } = await supabase.from("buildings").update(input).eq("id", buildingId);
  if (error) return { error: error.message };

  revalidatePath(`/dashboard/projects/${projectId}`);
  revalidatePath("/projects", "layout");
  return {};
}

export async function deleteBuilding(buildingId: string, projectId: string): Promise<ActionResult> {
  const supabase = await createClient();

  const { error } = await supabase.from("buildings").delete().eq("id", buildingId);
  if (error) return { error: error.message };

  revalidatePath(`/dashboard/projects/${projectId}`);
  revalidatePath("/projects", "layout");
  return {};
}
