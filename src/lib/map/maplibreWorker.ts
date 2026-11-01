// Point MapLibre at the worker file we serve from /public (copied from
// node_modules by scripts/copy-maplibre-worker.mjs). Without this the worker
// URL resolves to the page itself after bundling and the map never renders.
// Call once, right after importing maplibre-gl and before creating a Map.
type MapLibreModule = {
  setWorkerUrl: (url: string) => void;
  getVersion: () => string;
};

export function configureMaplibreWorker(mod: MapLibreModule) {
  // The version in the query string makes browsers fetch the new worker after
  // an upgrade instead of reusing a cached old one.
  mod.setWorkerUrl(`${window.location.origin}/maplibre-gl-worker.mjs?v=${encodeURIComponent(mod.getVersion())}`);
}
