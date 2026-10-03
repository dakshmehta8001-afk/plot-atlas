// Fixes one specific, common OCR slip: a plot's number read as a letter
// ("a" for 4). Plot numbers are unique and run in sequence, so when EXACTLY
// ONE plot has a label that isn't a number and EXACTLY ONE whole number is
// missing between 1 and the highest number found, that plot can only be the
// missing one. Anything less certain is left alone — several unreadable
// plots, or several missing numbers (as on Naman Infracity, where ~12 real
// numbers are unreadable), can't be matched up safely, and a wrong number
// is worse than a visibly blank one.
import type { DetectedShape } from "../types";

const PLAIN_NUMBER = /^\d{1,4}$/;

export function fillSingleMissingPlotNumber(shapes: DetectedShape[]): { shapes: DetectedShape[]; note: string | null } {
  const plots = shapes.filter((s) => s.kind === "plot" && s.source === "detected");
  const numbered = plots.filter((p) => PLAIN_NUMBER.test(p.label));
  const odd = plots.filter((p) => !PLAIN_NUMBER.test(p.label));
  if (odd.length !== 1 || odd[0].label === "" || numbered.length < 3) return { shapes, note: null };

  const seen = new Set(numbered.map((p) => Number(p.label)));
  if (seen.size !== numbered.length) return { shapes, note: null }; // duplicate numbers: sequence can't be trusted
  const highest = Math.max(...seen);
  const missing: number[] = [];
  for (let n = 1; n <= highest; n++) if (!seen.has(n)) missing.push(n);
  if (missing.length !== 1) return { shapes, note: null };

  const target = odd[0];
  const fixed = shapes.map((s) => (s === target ? { ...s, label: String(missing[0]) } : s));
  return {
    shapes: fixed,
    note: `Plot "${target.label}" was read as a letter. Set to ${missing[0]}, the only number missing from the sequence — please confirm.`,
  };
}
