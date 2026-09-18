"use server";

// Server Actions for units (both plots and flats): creating one from a
// freshly-traced polygon, editing its status/type/price/etc, and deleting
// it. Called directly as functions from client components (the polygon
// tracer and the unit edit panel) rather than via a <form action>, since the
// polygon point list is structured data, not naturally a form field.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./auth";
import type { PolygonPoint, UnitKind, UnitStatus } from "@/lib/types";

export interface UnitInput {
  unit_type: UnitKind;
  unit_number: string;
  building_id?: string | null;
  floor_id?: string | null;
  wing?: string | null;
  bhk_type?: string | null;
  category?: string | null;
  facing?: string | null;
  dimensions?: string | null;
  area_sqft?: number | null;
  carpet_area_sqft?: number | null;
  rate_per_sqft?: number | null;
  total_price?: number | null;
  polygon_points: PolygonPoint[];
}

export async function createUnit(projectId: string, input: UnitInput): Promise<ActionResult> {
  const supabase = await createClient();

  const { error } = await supabase.from("units").insert({
    project_id: projectId,
    building_id: input.building_id ?? null,
    floor_id: input.floor_id ?? null,
    unit_type: input.unit_type,
    unit_number: input.unit_number,
    wing: input.wing ?? null,
    bhk_type: input.bhk_type ?? null,
    category: input.category ?? null,
    facing: input.facing ?? null,
    dimensions: input.dimensions ?? null,
    area_sqft: input.area_sqft ?? null,
    carpet_area_sqft: input.carpet_area_sqft ?? null,
    rate_per_sqft: input.rate_per_sqft ?? null,
    total_price: input.total_price ?? null,
    polygon_points: input.polygon_points,
  });

  if (error) return { error: error.message };

  revalidatePath(`/dashboard/projects/${projectId}`, "layout");
  revalidatePath("/projects", "layout");
  return {};
}

export interface UnitUpdateInput {
  unit_number?: string;
  wing?: string | null;
  bhk_type?: string | null;
  category?: string | null;
  status?: UnitStatus;
  facing?: string | null;
  dimensions?: string | null;
  area_sqft?: number | null;
  carpet_area_sqft?: number | null;
  rate_per_sqft?: number | null;
  total_price?: number | null;
  polygon_points?: PolygonPoint[];
}

export async function updateUnit(
  unitId: string,
  projectId: string,
  input: UnitUpdateInput,
): Promise<ActionResult> {
  const supabase = await createClient();

  const { error } = await supabase.from("units").update(input).eq("id", unitId);
  if (error) return { error: error.message };

  revalidatePath(`/dashboard/projects/${projectId}`, "layout");
  revalidatePath("/projects", "layout");
  return {};
}

export async function deleteUnit(unitId: string, projectId: string): Promise<ActionResult> {
  const supabase = await createClient();

  const { error } = await supabase.from("units").delete().eq("id", unitId);
  if (error) return { error: error.message };

  revalidatePath(`/dashboard/projects/${projectId}`, "layout");
  revalidatePath("/projects", "layout");
  return {};
}
