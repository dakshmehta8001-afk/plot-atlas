// Sends a browser-side crash to /api/client-error, which writes it to the
// server log (visible via `vercel logs --level error`). Exists because a
// user-reported "This page couldn't load" crash happened on random pages on
// both phone and laptop, while production server logs showed nothing — the
// failure was purely in the browser, where we previously had no visibility
// at all. With this, every occurrence records what threw, on which page,
// in which browser, so the real cause can be read instead of guessed.
//
// Deliberately sends NO user identity (no email, no user id) — only the
// error itself, the page path, and the browser's user-agent string.

const MAX_FIELD = 2000;
// One crash often fires several events (window error + error boundary);
// skip exact repeats within a page session so the log stays readable.
const sent = new Set<string>();

export function reportClientError(source: string, error: unknown): void {
  try {
    const err = error instanceof Error ? error : new Error(typeof error === "string" ? error : JSON.stringify(error));
    const key = `${err.name}:${err.message}`;
    if (sent.has(key)) return;
    sent.add(key);

    const body = JSON.stringify({
      source,
      name: err.name,
      message: err.message.slice(0, MAX_FIELD),
      stack: (err.stack ?? "").slice(0, MAX_FIELD),
      digest: (err as Error & { digest?: string }).digest,
      path: window.location.pathname,
      userAgent: navigator.userAgent.slice(0, 300),
      deploymentId: document.documentElement.getAttribute("data-dpl-id"),
    });
    // sendBeacon survives the page being torn down (e.g. right before an
    // auto-reload); fall back to fetch where it's unavailable.
    const ok = navigator.sendBeacon?.("/api/client-error", new Blob([body], { type: "application/json" }));
    if (!ok) void fetch("/api/client-error", { method: "POST", body, keepalive: true, headers: { "Content-Type": "application/json" } });
  } catch {
    // Reporting must never itself become a crash.
  }
}
