import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @napi-rs/canvas ships a native .node binary (loaded via js-binding.js);
  // the bundler can't treat that as a normal ES module, so it has to be
  // excluded from Server Component bundling and loaded via plain Node
  // `require` at runtime instead. Needed for PDF plan-image uploads
  // (src/lib/pdfToImage.ts) — see the "canvas" entry in Next's own default
  // list for the same reasoning, which doesn't cover this fork of it.
  serverExternalPackages: ["@napi-rs/canvas"],
};

export default nextConfig;
