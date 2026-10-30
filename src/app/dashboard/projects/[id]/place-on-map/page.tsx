// Satellite alignment wizard for a project. The sub-admin clicks two
// recognisable spots on the plan image and the same two spots on the
// satellite map; the resulting SatelliteAlignment is stored in
// projects.map_bounds. Once saved, the public project map shows a
// Plan | Satellite switch.
import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AlignmentTool } from "@/components/map/AlignmentTool";
import type { Project, Unit, SatelliteAlignment, MapCalibration } from "@/lib/types";

export default async function PlaceOnMapPage(props: PageProps<"/dashboard/projects/[id]/place-on-map">) {
  const { id } = await props.params;
  const supabase = await createClient();

  const [{ data: project }, { data: units }] = await Promise.all([
    supabase.from("projects").select("*").eq("id", id).single(),
    supabase.from("units").select("*").eq("project_id", id).eq("unit_type", "plot"),
  ]);

  if (!project || !project.plan_image_url) notFound();

  const typedProject = project as Project;
  const plots = (units ?? []) as Unit[];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center gap-4">
        <Link
          href={`/dashboard/projects/${id}`}
          className="text-sm text-white/50 hover:text-white transition-colors"
        >
          ← {typedProject.name}
        </Link>
        <span className="text-white/20">/</span>
        <h1 className="text-lg font-semibold text-white">Place on map</h1>
      </div>

      <p className="mb-6 text-sm text-white/60 max-w-2xl">
        Paste a Google Maps coordinate for any point on this project&apos;s land, then click
        &quot;Auto-place&quot; — if the project has a scale and north direction set, the whole alignment is
        computed for you. Otherwise pick two landmarks manually: click each on the plan, then on the satellite.
      </p>

      <AlignmentTool
        projectId={id}
        planImageUrl={typedProject.plan_image_url!}
        plots={plots}
        existingAlignment={typedProject.map_bounds as SatelliteAlignment | null}
        calibration={typedProject.map_calibration as MapCalibration | null}
        imageWidth={typedProject.plan_image_width}
        imageHeight={typedProject.plan_image_height}
        projectLocation={typedProject.location}
      />
    </div>
  );
}
