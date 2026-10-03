// Shared by app/error.tsx and app/global-error.tsx — the safety net behind
// next.config.ts's `deploymentId` (the primary version-skew fix).
//
// A tab that was opened before a deploy can still occasionally hit a file
// or Server Action that only existed in the previous build (e.g. a lazily
// loaded chunk requested long after the page first loaded). That's never a
// real bug in the page — a fresh load of the same URL works — so the right
// recovery is a full reload, done for the user instead of making them
// read an error screen and click "Reload" themselves.

// Error text browsers and Next/Turbopack actually produce when a build's
// files or Server Action IDs are missing. Kept as plain substrings because
// each browser words the dynamic-import failure differently.
const STALE_BUILD_SIGNATURES = [
  "ChunkLoadError",
  "Loading chunk",
  "Loading CSS chunk",
  "Failed to load chunk",
  "Failed to fetch dynamically imported module", // Chrome / Edge
  "error loading dynamically imported module", // Firefox
  "Importing a module script failed", // Safari
  "Failed to find Server Action",
  "older or newer deployment",
];

export function isStaleBuildError(error: Error | undefined | null): boolean {
  if (!error) return false;
  const text = `${error.name ?? ""} ${error.message ?? ""}`;
  return STALE_BUILD_SIGNATURES.some((signature) => text.includes(signature));
}

const LAST_RELOAD_KEY = "plotatlas:stale-build-reload-at";
// If we already reloaded within this window and still hit a stale-build
// error, reloading again won't help (e.g. the network is down) — stop and
// show the error screen rather than loop forever.
const RELOAD_GUARD_MS = 30_000;

// Read-only decision, safe to call during render: is this a stale-build
// error we haven't already tried reloading for in the last 30s?
export function shouldAutoReload(error: Error | undefined | null): boolean {
  if (typeof window === "undefined" || !isStaleBuildError(error)) return false;
  try {
    const last = Number(sessionStorage.getItem(LAST_RELOAD_KEY) ?? 0);
    return Date.now() - last >= RELOAD_GUARD_MS;
  } catch {
    // sessionStorage can throw (private mode, blocked storage). Without a
    // guard we can't rule out a loop, so don't auto-reload — the error
    // screen's own Reload button still works.
    return false;
  }
}

// Side effect half — call from an effect only after shouldAutoReload()
// said yes. Records the attempt first so a second failure shows the
// error screen instead of reloading again.
export function markAndReload(): void {
  try {
    sessionStorage.setItem(LAST_RELOAD_KEY, String(Date.now()));
  } catch {
    return;
  }
  window.location.reload();
}
