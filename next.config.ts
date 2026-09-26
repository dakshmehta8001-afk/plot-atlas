import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next's default Server Action body limit is 1MB — fine for every other
  // action in this app (plain form fields, small JSON payloads), but the
  // digitize feature's "Save to project" step re-encodes the ENTIRE
  // uploaded plan image as a PNG File and passes it to uploadPlanImage()
  // as a Server Action argument (src/components/digitize/
  // DigitizeWorkspace.tsx's handleSave, when the project has no plan image
  // yet) — a real photographed/scanned plan capped at 2400px
  // (MAX_SOURCE_EDGE_PX in useDetectionPipeline.ts) re-encoded as PNG
  // routinely exceeds 1MB, especially for a busy/colorful image. Found via
  // live end-to-end testing against a real uploaded plan (a clean 2400px
  // vector site plan): saving failed with "Body exceeded 1 MB limit" and a
  // bare 500, silently losing the reviewer's work. 10mb comfortably covers
  // that re-encoded size while staying a real, bounded limit rather than
  // unlimited.
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
  // @napi-rs/canvas ships a native .node binary (loaded via js-binding.js);
  // the bundler can't treat that as a normal ES module, so it has to be
  // excluded from Server Component bundling and loaded via plain Node
  // `require` at runtime instead. Needed for PDF plan-image uploads
  // (src/lib/pdfToImage.ts) — see the "canvas" entry in Next's own default
  // list for the same reasoning, which doesn't cover this fork of it.
  serverExternalPackages: ["@napi-rs/canvas"],

  // pdfjs-dist's standard-font files (src/lib/pdfToImage.ts) are loaded via
  // a runtime fs path built from process.cwd(), not a static import/require
  // — Next's file-tracer (@vercel/nft) only follows actual import/require/fs
  // calls it can statically see, so a dynamically-built path like this one
  // needs to be told about explicitly or it's silently missing from the
  // deployed serverless bundle (worked locally, 404s in production).
  outputFileTracingIncludes: {
    "/*": [
      "node_modules/pdfjs-dist/standard_fonts/**/*",
      // pdfjs's Node "fake worker" locates its own worker script by a
      // runtime-resolved path (GlobalWorkerOptions.workerSrc in
      // pdfToImage.ts), not a static import Next's tracer can follow.
      "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    ],
  },
};

export default nextConfig;
