// MapLibre GL v6 finds its web worker relative to its own file. Once Next.js
// bundles the library that location is wrong, so the worker fails to start and
// the satellite map stays blank. We serve the worker ourselves from /public and
// point MapLibre at it (see src/lib/map/maplibreWorker.ts).
//
// The file is copied from node_modules on every dev/build so it always matches
// the installed maplibre-gl version. It is git-ignored.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";

const src = "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs";
if (!existsSync(src)) {
  console.error(`copy-maplibre-worker: ${src} not found. Run npm install first.`);
  process.exit(1);
}
mkdirSync("public", { recursive: true });
copyFileSync(src, "public/maplibre-gl-worker.mjs");
console.log("copy-maplibre-worker: public/maplibre-gl-worker.mjs updated");
