# Locally-hosted OpenCV.js

`opencv.js` here is a committed static copy of
`node_modules/@techstark/opencv-js/dist/opencv.js`, loaded via a plain
injected `<script>` tag (see `src/lib/digitize/opencvLoader.ts`) rather than
an ES/CJS import.

That's not the usual way to consume an npm package, and it's deliberate:
importing it normally hit a real Turbopack production-build bug — the
package's UMD bundle sets `module.exports` to a value that, before OpenCV's
WASM runtime finishes initializing, is itself a `Promise` (see the
package's own README for this "not ready yet" pattern). Turbopack's
async-module handling auto-detects any CJS module whose exports look
thenable and tries to await/unwrap it as part of its own module-loading
protocol, which collides with this package actually wanting to hand back a
Promise as its real value — the observed failure was `TypeError: Method
Promise.prototype.then called on incompatible receiver [object Module]`,
thrown from deep inside Turbopack's own chunk-loading runtime, only in a
production build (not `next dev`), only once actually run in a browser
(not caught by `tsc`/build-time type checking).

A plain `<script>` tag sidesteps this entirely: the browser just executes
the UMD bundle as a global script (its "browser globals" branch sets
`globalThis.cv`), with no bundler module system involved.

**If `@techstark/opencv-js` is ever upgraded**, re-copy this file:
`cp node_modules/@techstark/opencv-js/dist/opencv.js public/opencv.js`
(the package itself is not a runtime dependency — it was removed from
`package.json` after this copy was made, so there is nothing to `npm
update`; reinstall it temporarily if a newer copy is needed).
