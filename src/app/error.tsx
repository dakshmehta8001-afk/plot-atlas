"use client";

// App-wide error boundary (renders inside the root layout, so the normal
// nav and styles stay visible). Replaces Next's bare default screen.
//
// Two cases:
// - Stale build (tab opened before a deploy, now missing files): reload
//   automatically, once — see lib/staleBuildRecovery.ts.
// - Anything else: say so plainly and offer Try again / Reload / Back.
//   Next 16 names the recovery callback `retry` (it was `reset` before).
import { useEffect, useState } from "react";
import { markAndReload, shouldAutoReload } from "@/lib/utils/staleBuildRecovery";
import { reportClientError } from "@/lib/utils/reportClientError";

export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  // Decided once, at mount — the effect below only carries it out.
  const [reloading] = useState(() => shouldAutoReload(error));

  useEffect(() => {
    console.error(error);
    reportClientError(reloading ? "boundary-stale-build" : "boundary", error);
    if (reloading) markAndReload();
  }, [error, reloading]);

  if (reloading) {
    return <p className="mx-auto max-w-md px-4 py-24 text-center text-sm text-gray-600 dark:text-gray-300">Loading the latest version…</p>;
  }

  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Something went wrong on this page</h1>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
        Your saved work is safe. Try again, or reload the page. If it keeps happening, note what you clicked just before
        and let us know.
      </p>
      {error.digest && <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">Reference: {error.digest}</p>}
      <div className="mt-6 flex justify-center gap-2">
        <button onClick={() => retry()} className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200">
          Try again
        </button>
        <button
          onClick={() => window.location.reload()}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          Reload
        </button>
        <button
          onClick={() => window.history.back()}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          Back
        </button>
      </div>
    </div>
  );
}
