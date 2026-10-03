// Runs in the browser before the app becomes interactive (Next 16 file
// convention). Catches crashes that never reach an error.tsx boundary —
// errors thrown in event handlers, timers, and promise rejections (e.g. a
// failed Server Action or fetch) — and reports them the same way.
import { reportClientError } from "@/lib/reportClientError";

window.addEventListener("error", (event) => reportClientError("window.error", event.error ?? event.message));
window.addEventListener("unhandledrejection", (event) => reportClientError("unhandledrejection", event.reason));
