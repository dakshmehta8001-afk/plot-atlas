// Satellite alignment wizard for a project. The sub-admin clicks two
// recognisable spots on the plan image and the same two spots on the
// satellite map; the resulting SatelliteAlignment is stored in
// projects.map_bounds. Once saved, the public project map shows a
// Plan | Satellite switch.
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { createClient } from "@/lib/supabase/server";
import { AlignmentTool } from "@/components/map/AlignmentTool";
import type { Project, Unit, Road, SiteFeature, SatelliteAlignment, MapCalibration } from "@/lib/types";

export default async function PlaceOnMapPage(props: PageProps<"/dashboard/projects/[id]/place-on-map">) {
  const { id } = await props.params;
  const supabase = await createClient();

  const [{ data: project }, { data: units }, { data: roadRows }, { data: featureRows }] = await Promise.all([
    supabase.from("projects").select("*").eq("id", id).single(),
    supabase.from("units").select("*").eq("project_id", id).eq("unit_type", "plot"),
    supabase.from("roads").select("*").eq("project_id", id),
    supabase.from("site_features").select("*").eq("project_id", id),
  ]);

  if (!project || !project.plan_image_url) notFound();

  const typedProject = project as Project;
  const plots = (units ?? []) as Unit[];

  return (
    <div>
      <PageHeader
        crumbs={[
          { label: "Projects", href: "/dashboard" },
          { label: typedProject.name, href: `/dashboard/projects/${id}` },
          { label: "Place on map" },
        ]}
        title="Place on map"
        subtitle="Paste a Google Maps link or coordinates for the site, then drag, rotate, and resize until the plots line up with the satellite image."
      />

      <AlignmentTool
        projectId={id}
        planImageUrl={typedProject.plan_image_url!}
        plots={plots}
        roads={(roadRows ?? []) as Road[]}
        features={(featureRows ?? []) as SiteFeature[]}
        existingAlignment={typedProject.map_bounds as SatelliteAlignment | null}
        calibration={typedProject.map_calibration as MapCalibration | null}
        imageWidth={typedProject.plan_image_width}
        imageHeight={typedProject.plan_image_height}
        projectLocation={typedProject.location}
      />
    </div>
  );
}
