# Locally-hosted Tesseract.js OCR assets

Tesseract.js fetches its worker script, WASM core, and language trained-data
from a CDN (jsdelivr) by default. That would silently violate this feature's
"no cloud dependency at runtime" requirement, so these files are copied here
and referenced by local path instead (see `src/lib/digitize/ocrWorker.ts`).

Where each file came from (re-run these if `tesseract.js`/`tesseract.js-core`
get upgraded and the OCR pipeline needs refreshing):

- `worker.min.js` — copied from `node_modules/tesseract.js/dist/worker.min.js`
- `core/*` — copied from `node_modules/tesseract.js-core/tesseract-core-*lstm*`
  (the three `-lstm` variants only: plain, `simd`, `relaxedsimd`. The non-LSTM
  "full"/legacy variants aren't copied since this app never requests the
  Legacy OCR engine — see the `oem` parameter in `ocrWorker.ts`. Tesseract.js
  picks whichever variant the browser's WASM feature support allows at
  runtime, so all three need to be present even though only one is fetched.)
- `lang-data/eng.traineddata.gz` — copied from the npm package
  `@tesseract.js-data/eng`'s `4.0.0_best_int` variant (the smaller,
  quantized model matching Tesseract.js's default LSTM-only engine — the
  larger non-`_best_int` variant is for the Legacy engine, not used here).
  That package was installed once just to extract this file and is not a
  runtime dependency, so it was removed from `package.json` afterward.
