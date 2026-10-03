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
import { markAndReload, shouldAutoReload } from "@/lib/staleBuildRecovery";

export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  // Decided once, at mount — the effect below only carries it out.
  const [reloading] = useState(() => shouldAutoReload(error));

  useEffect(() => {
    console.error(error);
    if (reloading) markAndReload();
  }, [error, reloading]);

  if (reloading) {
    return <p className="mx-auto max-w-md px-4 py-24 text-center text-sm text-slate-600">Loading the latest version…</p>;
  }

  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <h1 className="text-xl font-semibold text-slate-900">Something went wrong on this page</h1>
      <p className="mt-2 text-sm text-slate-600">
        Your saved work is safe. Try again, or reload the page. If it keeps happening, note what you clicked just before
        and let us know.
      </p>
      {error.digest && <p className="mt-2 text-xs text-slate-400">Reference: {error.digest}</p>}
      <div className="mt-6 flex justify-center gap-2">
        <button onClick={() => retry()} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
          Try again
        </button>
        <button
          onClick={() => window.location.reload()}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Reload
        </button>
        <button
          onClick={() => window.history.back()}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Back
        </button>
      </div>
    </div>
  );
}
