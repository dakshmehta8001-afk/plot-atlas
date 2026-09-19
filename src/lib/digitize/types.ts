// Types local to the auto-digitize pipeline/editor. Deliberately separate
// from src/lib/types.ts (which mirrors the Postgres schema): a DetectedShape
// only exists in the browser, in memory, until the reviewer clicks "Save to
// project" — at that point it's translated into the real Unit/Road/
// SiteFeature rows those existing tables expect (see
// src/lib/actions/digitize.ts). Mixing the two would make it look like
// DetectedShape is a persisted concept, which it never is.
import type { PolygonPoint, SiteFeatureKind, UnitStatus } from "@/lib/types";

export type ShapeKind = "plot" | "road" | "feature";

export interface DetectedShape {
  /** Client-only identity (crypto.randomUUID()) — never sent to the database; the row gets a real id on insert. */
  localId: string;
  kind: ShapeKind;
  points: PolygonPoint[];
  /** Plot number, road width label, or feature label — whichever applies to `kind`. */
  label: string;
  /** Plots only; defaults to "available" for anything freshly detected or hand-drawn. */
  status?: UnitStatus;
  /** Features only. */
  featureKind?: SiteFeatureKind;
  /** Rough 0..1 heuristic from the contour filters in detection/plots.ts — a review-UI hint (e.g. a dashed outline), never persisted and never claimed as real accuracy. */
  confidence?: number;
  source: "detected" | "manual";
}

// One entry per stage the user actually sees in the progress UI — the exact
// copy the user specified, so ProcessingProgress.tsx just looks this up
// rather than hardcoding strings in two places.
export type PipelineStage =
  | "idle"
  | "loading-engine"
  | "preparing"
  | "detecting-layout"
  | "detecting-roads"
  | "detecting-plots"
  | "reading-labels"
  | "building-map"
  | "done"
  | "error";

export const STAGE_COPY: Record<PipelineStage, string> = {
  idle: "",
  "loading-engine": "Loading detection engine…",
  preparing: "Preparing image…",
  "detecting-layout": "Detecting layout…",
  "detecting-roads": "Detecting roads…",
  "detecting-plots": "Detecting plot boundaries…",
  "reading-labels": "Reading plot numbers…",
  "building-map": "Building digital map…",
  done: "Done",
  error: "Something went wrong",
};

export interface DetectionResult {
  shapes: DetectedShape[];
  /** Non-fatal issues to surface in the review UI, e.g. "No plot-like shapes found — try tracing manually" or "OCR found no readable text." */
  warnings: string[];
}
