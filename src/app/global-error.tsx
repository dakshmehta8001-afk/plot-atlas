"use client";

// Last-resort boundary for errors in the root layout itself. It replaces
// the whole document, so it must render its own <html>/<body> and can't
// rely on globals.css — hence inline styles. Same two cases as
// app/error.tsx: auto-reload once for a stale build, otherwise a plain
// message with Try again / Reload.
import { useEffect, useState } from "react";
import { markAndReload, shouldAutoReload } from "@/lib/utils/staleBuildRecovery";
import { reportClientError } from "@/lib/utils/reportClientError";

const button: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: 6,
  fontSize: 14,
  cursor: "pointer",
  border: "1px solid #cbd5e1",
  background: "#fff",
  color: "#334155",
};

export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  // Decided once, at mount — the effect below only carries it out.
  const [reloading] = useState(() => shouldAutoReload(error));

  useEffect(() => {
    console.error(error);
    reportClientError(reloading ? "boundary-stale-build" : "boundary", error);
    if (reloading) markAndReload();
  }, [error, reloading]);

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#fff", color: "#0f172a" }}>
        <title>PlotAtlas</title>
        <div style={{ maxWidth: 420, margin: "0 auto", padding: "96px 16px", textAlign: "center" }}>
          {reloading ? (
            <p style={{ fontSize: 14, color: "#475569" }}>Loading the latest version…</p>
          ) : (
            <>
              <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Something went wrong</h1>
              <p style={{ fontSize: 14, color: "#475569", marginTop: 8 }}>
                Your saved work is safe. Try again, or reload the page.
              </p>
              {error.digest && <p style={{ fontSize: 12, color: "#94a3b8" }}>Reference: {error.digest}</p>}
              <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 24 }}>
                <button onClick={() => retry()} style={{ ...button, background: "#0f172a", color: "#fff", border: "none" }}>
                  Try again
                </button>
                <button onClick={() => window.location.reload()} style={button}>
                  Reload
                </button>
              </div>
            </>
          )}
        </div>
      </body>
    </html>
  );
}
