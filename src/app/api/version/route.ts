import { NextResponse } from "next/server";

// Always re-evaluate on every request so the browser gets the CURRENT
// deployment's commit SHA, not a cached stale one.
export const dynamic = "force-dynamic";

export function GET() {
  const build =
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ??
    process.env.BUILD_ID ??
    "dev";
  return NextResponse.json({ build });
}
