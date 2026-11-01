// Review-time checks on plot numbers. Detection reads numbers from the plan
// with OCR, which sometimes misreads a symbol ("<", "¥", "30°") or skips a
// number. Flagging these before saving lets the reviewer fix them, instead of
// a wrong plot being silently skipped as a duplicate or saved as junk.
import type { DetectedShape } from "@/lib/digitize/types";

export type LabelIssue = "missing" | "unusual" | "duplicate";

// 1 to 4 digits with an optional letter prefix and suffix: 7, 38, A-12, 12B.
const PLAUSIBLE = /^[A-Za-z]{0,2}[-\s]?\d{1,4}[A-Za-z]?$/;

export const LABEL_ISSUE_TEXT: Record<LabelIssue, string> = {
  missing: "No plot number yet. Enter one, or leave it blank to save as Unlabeled.",
  unusual: "This does not look like a plot number. The reader may have misread it.",
  duplicate: "Another plot has the same number. Numbers must be unique in a project.",
};

/** Issue per plot, keyed by localId. Plots with no issue are not in the map. */
export function plotLabelIssues(shapes: DetectedShape[]): Map<string, LabelIssue> {
  const plots = shapes.filter((s) => s.kind === "plot");
  const counts = new Map<string, number>();
  for (const p of plots) {
    const key = p.label.trim().toLowerCase();
    if (key && key !== "unlabeled") counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const issues = new Map<string, LabelIssue>();
  for (const p of plots) {
    const label = p.label.trim();
    const key = label.toLowerCase();
    if (!label || key === "unlabeled") issues.set(p.localId, "missing");
    else if ((counts.get(key) ?? 0) > 1) issues.set(p.localId, "duplicate");
    else if (!PLAUSIBLE.test(label)) issues.set(p.localId, "unusual");
  }
  return issues;
}
