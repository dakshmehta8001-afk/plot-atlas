"use server";

// The one write path for the auto-digitize feature: after a sub-admin
// reviews/corrects the automatically detected shapes (src/components/
// digitize/*), this bulk-inserts them into the SAME tables the manual
// tracer writes to (units/roads/site_features) — a digitized plot is
// indistinguishable from a manually-traced one afterward. Deliberately a
// single action (one round trip for potentially dozens of shapes) rather
// than looping createUnit/createRoad/createSiteFeature client-side.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./auth";
import type { PolygonPoint, SiteFeatureKind, UnitStatus } from "@/lib/types";

export interface DigitizedShapeInput {
  kind: "plot" | "road" | "feature";
  points: PolygonPoint[];
  label: string;
  status?: UnitStatus;
  featureKind?: SiteFeatureKind;
}

export interface DigitizeSaveInput {
  projectId: string;
  shapes: DigitizedShapeInput[];
}

export async function saveDigitizedShapes(
  input: DigitizeSaveInput,
): Promise<ActionResult & { created?: number }> {
  const supabase = await createClient();

  const plotRows = input.shapes
    .filter((s) => s.kind === "plot")
    .map((s) => ({
      project_id: input.projectId,
      unit_type: "plot" as const,
      unit_number: s.label,
      status: s.status ?? ("available" as UnitStatus),
      polygon_points: s.points,
    }));

  const roadRows = input.shapes
    .filter((s) => s.kind === "road")
    .map((s) => ({
      project_id: input.projectId,
      width_label: s.label,
      path_points: s.points,
    }));

  const featureRows = input.shapes
    .filter((s) => s.kind === "feature")
    .map((s) => ({
      project_id: input.projectId,
      kind: s.featureKind ?? ("other" as SiteFeatureKind),
      label: s.label,
      polygon_points: s.points,
    }));

  if (plotRows.length > 0) {
    const { error } = await supabase.from("units").insert(plotRows);
    if (error) return { error: `Saving plots failed: ${error.message}` };
  }
  if (roadRows.length > 0) {
    const { error } = await supabase.from("roads").insert(roadRows);
    if (error) return { error: `Saving roads failed: ${error.message}` };
  }
  if (featureRows.length > 0) {
    const { error } = await supabase.from("site_features").insert(featureRows);
    if (error) return { error: `Saving areas failed: ${error.message}` };
  }

  revalidatePath(`/dashboard/projects/${input.projectId}`, "layout");
  revalidatePath("/projects", "layout");
  return { created: plotRows.length + roadRows.length + featureRows.length };
}
