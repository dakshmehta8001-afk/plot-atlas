import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Version-skew protection. Without this, a tab left open across a deploy
  // keeps running the OLD build's JavaScript; its next client-side click
  // (or Server Action call) asks the NEW deployment for chunk files and
  // action IDs that no longer exist, and Next falls over to its bare
  // "This page couldn't load" screen. Confirmed as the real cause of a
  // user-reported "random page, phone and laptop, again and again" crash:
  // production server logs had zero errors, every one of 79 live pages
  // loaded cleanly when opened fresh, and the live HTML carried no
  // deployment ID at all — so Next had no way to tell an open tab was stale.
  // With a per-deployment ID, Next compares it on every navigation and does
  // a full page reload on mismatch instead of failing. VERCEL_DEPLOYMENT_ID
  // is set automatically on every Vercel build; it's undefined locally,
  // which simply leaves the feature off in `next dev`.
  deploymentId: process.env.VERCEL_DEPLOYMENT_ID,
};

export default nextConfig;
