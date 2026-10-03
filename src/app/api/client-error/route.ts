// Receives browser crash reports from lib/reportClientError.ts and writes
// them to the server log as one JSON line, so they show up under
// `vercel logs --level error`. Public on purpose (crashes happen on public
// pages and for logged-out visitors too); it stores nothing and only logs,
// with a hard size cap so it can't be used to flood the log with big bodies.
import { NextResponse, type NextRequest } from "next/server";

const MAX_BODY_BYTES = 8 * 1024;

export async function POST(request: NextRequest) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return new NextResponse(null, { status: 413 });

  let report: Record<string, unknown>;
  try {
    report = JSON.parse(text);
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  // Only known fields, each coerced to a bounded string — never echo
  // arbitrary client-supplied keys into the log.
  const fields = ["source", "name", "message", "stack", "digest", "path", "userAgent", "deploymentId"] as const;
  const clean: Record<string, string> = {};
  for (const f of fields) {
    if (report[f] != null) clean[f] = String(report[f]).slice(0, 2000);
  }
  console.error("[client-error]", JSON.stringify(clean));
  return new NextResponse(null, { status: 204 });
}
