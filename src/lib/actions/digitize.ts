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
  /** Plots only — see DetectedShape in src/lib/digitize/types.ts for what computes these. */
  dimensions?: string;
  areaSqft?: number;
  category?: string;
  needsDimensionReview?: boolean;
}

export interface DigitizeSaveInput {
  projectId: string;
  shapes: DigitizedShapeInput[];
}

// A polygon needs >=3 points to be a real shape, a road (open polyline)
// needs >=2 — the DB only enforces `not null` on polygon_points/path_points,
// not a minimum length. The review canvas UI already guards every path that
// could produce an under-count shape (manual draw's MIN_DRAW_POINTS, the
// split tool's <3-point rejection, vertex-delete's floor), so this isn't
// currently reachable through normal use — but it's exactly the shape of
// bug that produced a batch of stray "Unlabeled" rows during earlier
// testing, and this action has no server-side backstop if a future UI
// change (or a direct call to this action, bypassing the UI) reintroduces
// it. Rejecting the WHOLE save up front (rather than silently dropping the
// bad shape) means a sub-admin never loses work without knowing why.
function minPointsFor(kind: DigitizedShapeInput["kind"]): number {
  return kind === "road" ? 2 : 3;
}

export async function saveDigitizedShapes(
  input: DigitizeSaveInput,
): Promise<ActionResult & { created?: number }> {
  const invalidShape = input.shapes.find((s) => s.points.length < minPointsFor(s.kind));
  if (invalidShape) {
    return {
      error: `"${invalidShape.label || "Unlabeled"}" has only ${invalidShape.points.length} point(s) — a ${invalidShape.kind} needs at least ${minPointsFor(invalidShape.kind)}.`,
    };
  }

  const supabase = await createClient();

  const plotRows = input.shapes
    .filter((s) => s.kind === "plot")
    .map((s) => ({
      unit_number: s.label,
      status: s.status ?? ("available" as UnitStatus),
      polygon_points: s.points,
      dimensions: s.dimensions ?? null,
      area_sqft: s.areaSqft ?? null,
      category: s.category ?? null,
      needs_dimension_review: s.needsDimensionReview ?? false,
    }));

  const roadRows = input.shapes
    .filter((s) => s.kind === "road")
    .map((s) => ({
      width_label: s.label,
      path_points: s.points,
    }));

  const featureRows = input.shapes
    .filter((s) => s.kind === "feature")
    .map((s) => ({
      kind: s.featureKind ?? ("other" as SiteFeatureKind),
      label: s.label,
      polygon_points: s.points,
    }));

  // A single RPC (supabase/migrations/20260926000200_add_save_digitized_shapes_rpc.sql)
  // wraps all three inserts in one transaction, rather than three separate
  // .insert() calls — a mid-save failure now rolls back everything instead
  // of leaving the earlier inserts committed (which risked duplicating them
  // on retry, since the review canvas's local state is only cleared once
  // the WHOLE save reports success).
  const { data, error } = await supabase.rpc("save_digitized_shapes", {
    p_project_id: input.projectId,
    p_plots: plotRows,
    p_roads: roadRows,
    p_features: featureRows,
  });
  if (error) return { error: error.message };

  revalidatePath(`/dashboard/projects/${input.projectId}`, "layout");
  revalidatePath("/projects", "layout");
  return { created: data ?? 0 };
}
