// A sub-admin's per-project workspace: the manual polygon-tracing tool
// (plots + building footprints) over the master site-plan image, the list
// of buildings (each linking to its own floors/flats management page), the
// plots table, the media gallery, and a publish toggle. Fetches by id and
// relies on RLS (public read on published projects, owner read on drafts)
// rather than re-checking ownership here — writes are what RLS actually
// gates.
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProjectTracerClient } from "@/components/ProjectTracerClient";
import { PlanImageUpload } from "@/components/PlanImageUpload";
import { MediaManager } from "@/components/MediaManager";
import { PublishToggle } from "@/components/PublishToggle";
import { ProjectDetailsForm } from "@/components/ProjectDetailsForm";
import { StatusBadge, CategoryBadge } from "@/components/StatusBadge";
import type { Building, Project, ProjectMedia, Road, Unit } from "@/lib/types";

export default async function ManageProjectPage(props: PageProps<"/dashboard/projects/[id]">) {
  const { id } = await props.params;
  const supabase = await createClient();

  const { data: project } = await supabase.from("projects").select("*").eq("id", id).single();
  if (!project) notFound();

  const [{ data: units }, { data: buildings }, { data: roads }, { data: media }] = await Promise.all([
    supabase.from("units").select("*").eq("project_id", id).order("unit_number"),
    supabase.from("buildings").select("*").eq("project_id", id).order("name"),
    supabase.from("roads").select("*").eq("project_id", id).order("created_at"),
    supabase.from("project_media").select("*").eq("project_id", id).order("sort_order"),
  ]);

  const typedProject = project as Project;
  const allUnits = (units ?? []) as Unit[];
  const plots = allUnits.filter((u) => u.unit_type === "plot");
  const flats = allUnits.filter((u) => u.unit_type === "flat");
  const typedBuildings = (buildings ?? []) as Building[];
  const typedRoads = (roads ?? []) as Road[];
  const typedMedia = (media ?? []) as ProjectMedia[];

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{typedProject.name}</h1>
        <div className="flex gap-2">
          <ProjectDetailsForm project={typedProject} />
          <PublishToggle projectId={id} status={typedProject.status} />
        </div>
      </div>
      <p className="mb-6 text-gray-500">
        {plots.length} plot(s) · {typedBuildings.length} building(s) · {flats.length} flat(s) · {typedRoads.length} road(s) traced
      </p>

      {typedProject.plan_image_url ? (
        <ProjectTracerClient
          projectId={id}
          planImageUrl={typedProject.plan_image_url}
          plots={plots}
          buildings={typedBuildings}
          roads={typedRoads}
        />
      ) : (
        <PlanImageUpload projectId={id} />
      )}

      {typedBuildings.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">Buildings</h2>
          <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
            {typedBuildings.map((building) => (
              <li key={building.id} className="flex items-center justify-between p-4">
                <div>
                  <p className="font-medium">{building.name}</p>
                  <p className="text-sm text-gray-500">{building.total_floors ?? "—"} floor(s) planned</p>
                </div>
                <Link href={`/dashboard/projects/${id}/buildings/${building.id}`} className="text-sm underline">
                  Manage floors &amp; flats
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {plots.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">Plots</h2>
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="p-3">Plot</th>
                  <th className="p-3">Area</th>
                  <th className="p-3">Size</th>
                  <th className="p-3">Facing</th>
                  <th className="p-3">Price</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Category</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {plots.map((unit) => (
                  <tr key={unit.id}>
                    <td className="p-3 font-medium">{unit.unit_number}</td>
                    <td className="p-3">{unit.area_sqft ? `${unit.area_sqft.toLocaleString()} sq ft` : "—"}</td>
                    <td className="p-3">{unit.dimensions ?? "—"}</td>
                    <td className="p-3">{unit.facing ?? "—"}</td>
                    <td className="p-3">{unit.total_price ? `₹${unit.total_price.toLocaleString()}` : "—"}</td>
                    <td className="p-3">
                      <StatusBadge status={unit.status} />
                    </td>
                    <td className="p-3">
                      <CategoryBadge category={unit.category} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-gray-500">Click a plot&apos;s polygon on the map above to edit it.</p>
        </div>
      )}

      <div className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">Media gallery</h2>
        <MediaManager projectId={id} media={typedMedia} />
      </div>
    </div>
  );
}
