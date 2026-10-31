// Turns a duplicate-plot-number database error into a message a sub-admin
// can act on. The unique index units_unique_plot_number
// (supabase/migrations/20261028000400_unique_plot_numbers.sql) makes a plot
// number unique per project; Postgres then reports error code 23505.
//
// Kept outside the "use server" action files because those may only export
// async functions.

interface DbError {
  code?: string;
  message?: string;
  details?: string | null;
}

/**
 * Returns "Plot number X already exists." when `error` is the duplicate plot
 * number violation, otherwise null. `number` is used when the caller knows
 * it (createUnit, updateUnit); otherwise it is read from the error details,
 * which look like:
 *   Key (project_id, lower(TRIM(BOTH FROM unit_number)))=(<uuid>, 12) already exists.
 */
export function plotNumberConflictMessage(error: DbError | null, number?: string): string | null {
  if (!error || error.code !== "23505") return null;
  const text = `${error.message ?? ""} ${error.details ?? ""}`;
  if (!text.includes("units_unique_plot_number") && !text.includes("unit_number")) return null;
  const fromDetails = /\)=\([^,]+,\s*(.*)\) already exists/.exec(error.details ?? "")?.[1];
  const shown = (number ?? fromDetails ?? "").trim();
  return shown ? `Plot number ${shown} already exists.` : "That plot number already exists.";
}
