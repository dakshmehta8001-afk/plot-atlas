// Entry point for the auto-digitize feature — a Server Component shell only
// (the actual OpenCV.js/Tesseract.js workspace is 100% client-side, loaded
// via DigitizeWorkspaceLoader). This page's only job is the RLS-backed
// project fetch and ownership check, same pattern as
// buildings/[buildingId]/page.tsx: a non-owner/non-admin gets `notFound()`
// because RLS silently returns no row, not a special check here.
import { PageHeader } from "@/components/dashboard/PageHeader";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DigitizeWorkspaceLoader } from "@/components/digitize/DigitizeWorkspaceLoader";
import type { MapCalibration } from "@/lib/types";

export default async function DigitizePage(props: PageProps<"/dashboard/projects/[id]/digitize">) {
  const { id } = await props.params;
  const supabase = await createClient();

  const [{ data: project }, { data: existingUnits }, { count: roadCount }, { count: featureCount }] =
    await Promise.all([
      supabase.from("projects").select("id, name, plan_image_url, map_calibration").eq("id", id).single(),
      supabase.from("units").select("unit_number").eq("project_id", id),
      supabase.from("roads").select("id", { count: "exact", head: true }).eq("project_id", id),
      supabase.from("site_features").select("id", { count: "exact", head: true }).eq("project_id", id),
    ]);
  if (!project) notFound();

  const existingPlotNumbers = (existingUnits ?? []).map((u) => u.unit_number as string).filter(Boolean);

  return (
    // A fixed viewport-relative height + overflow-hidden here used to clip
    // the workspace with no way to scroll to whatever didn't fit (the exact
    // amount of browser chrome above this varies — window size, zoom level,
    // OS chrome — so any fixed calc() is a guess that's wrong for some
    // viewports). Letting the page flow and scroll normally, with the
    // canvas itself given a comfortable fixed height below, works
    // regardless of viewport size.
    <div className="flex flex-col">
      <PageHeader
        crumbs={[
          { label: "Projects", href: "/dashboard" },
          { label: project.name, href: `/dashboard/projects/${id}` },
          { label: "Digitize" },
        ]}
        title="Digitize plan"
        subtitle="Shapes are detected automatically. Review and correct them before saving."
      />
      <DigitizeWorkspaceLoader
        projectId={id}
        projectName={project.name}
        hasExistingPlanImage={!!project.plan_image_url}
        planImageUrl={project.plan_image_url}
        initialCalibration={project.map_calibration as MapCalibration | null}
        existingPlotNumbers={existingPlotNumbers}
        existingRoadCount={roadCount ?? 0}
        existingFeatureCount={featureCount ?? 0}
      />
    </div>
  );
}
