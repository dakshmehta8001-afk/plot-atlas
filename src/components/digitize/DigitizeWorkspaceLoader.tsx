"use client";

// `ssr: false` on next/dynamic can only be called from a Client Component
// (Next.js's App Router rejects it directly inside a Server Component) —
// this tiny wrapper is that boundary. It exists purely so the route's
// page.tsx can stay a normal Server Component doing the RLS-backed data
// fetch, while the actual OpenCV/Tesseract-heavy workspace never gets
// evaluated during server rendering at all.
import dynamic from "next/dynamic";
import type { MapCalibration } from "@/lib/types";

const DigitizeWorkspace = dynamic(() => import("./DigitizeWorkspace").then((m) => m.DigitizeWorkspace), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-gray-400">Loading digitizer…</div>
  ),
});

export function DigitizeWorkspaceLoader(props: {
  projectId: string;
  projectName: string;
  hasExistingPlanImage: boolean;
  initialCalibration: MapCalibration | null;
}) {
  return <DigitizeWorkspace {...props} />;
}
