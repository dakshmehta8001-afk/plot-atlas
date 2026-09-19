// Loads OpenCV.js via a plain injected <script> tag from public/opencv.js,
// NOT an ES/CJS import — deliberately, after hitting a real bundling bug:
// @techstark/opencv-js's UMD build sets `module.exports` to a value that,
// before the WASM runtime finishes initializing, IS ITSELF a Promise (its
// tail does `moduleRtn = new Promise(...)`, matching the "not ready yet"
// branch documented in the package's own README). Turbopack's async-module
// handling auto-detects any CJS module whose exports look thenable and
// tries to await/unwrap it as part of its OWN module-loading protocol —
// which collides with this package actually WANTING to hand back a Promise
// as its real runtime value, producing (in production only, confirmed via
// a real deployed build, not just a hunch): "TypeError: Method
// Promise.prototype.then called on incompatible receiver [object Module]"
// deep inside Turbopack's chunk-loading runtime.
//
// A classic `<script>` tag sidesteps this entirely: the browser just runs
// the UMD bundle as a global script (its own "Browser globals" branch sets
// `globalThis.cv`), with no bundler module system involved at all. The
// tradeoff is losing npm version pinning for this one file — public/opencv.js
// is a committed static copy of node_modules/@techstark/opencv-js's
// dist/opencv.js, refreshed manually if that package is ever upgraded (same
// pattern as public/tesseract/, see its README for why that one needs the
// same treatment for a different reason — avoiding a CDN dependency).
//
// The readiness contract below is unchanged from what the package's own
// README documents (see the git history of this file for the version that
// tried the ES import) — the global can be a Promise, an already-ready
// module (has `.Mat`), or a not-yet-ready module needing
// `onRuntimeInitialized`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Cv = any;

let cvPromise: Promise<Cv> | null = null;

function loadScriptOnce(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)));
      // If it already finished loading before this listener attached, there's
      // no further "load" event coming — detected via the same readiness
      // check the caller does on globalThis.cv, not here.
      if ((existing as HTMLScriptElement).dataset.loaded === "true") resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

export function loadOpenCv(): Promise<Cv> {
  if (!cvPromise) {
    cvPromise = loadScriptOnce("/opencv.js").then(
      () =>
        new Promise<Cv>((resolve) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const cvGlobal: any = (globalThis as any).cv;
          if (cvGlobal instanceof Promise) {
            cvGlobal.then(resolve);
          } else if (cvGlobal?.Mat) {
            resolve(cvGlobal);
          } else {
            cvGlobal.onRuntimeInitialized = () => resolve(cvGlobal);
          }
        }),
    );
  }
  return cvPromise;
}
