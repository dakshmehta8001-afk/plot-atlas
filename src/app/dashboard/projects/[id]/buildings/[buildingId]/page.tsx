// A sub-admin's per-building workspace: add floors (each with its own plate
// layout image), then trace that floor's flats. This is where the
// buildings/floors/flats data model — the first priority out of the full
// spec — actually gets filled in, floor by floor.
import { notFound } from "next/navigation";
import { PageHeader, EmptyState } from "@/components/dashboard/PageHeader";
import { createClient } from "@/lib/supabase/server";
import { FloorTracerClient } from "@/components/map/FloorTracerClient";
import { AddFloorButton } from "@/components/ui/AddFloorButton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { floorLabel, sortFloors, type Building, type Floor, type Unit } from "@/lib/types";

export default async function ManageBuildingPage(
  props: PageProps<"/dashboard/projects/[id]/buildings/[buildingId]">,
) {
  const { id, buildingId } = await props.params;
  const supabase = await createClient();

  const { data: building } = await supabase.from("buildings").select("*").eq("id", buildingId).single();
  if (!building) notFound();

  const [{ data: floors }, { data: units }] = await Promise.all([
    supabase.from("floors").select("*").eq("building_id", buildingId),
    supabase.from("units").select("*").eq("building_id", buildingId),
  ]);

  const typedBuilding = building as Building;
  const typedFloors = sortFloors((floors ?? []) as Floor[]);
  const allFlats = (units ?? []) as Unit[];

  return (
    <div>
      <PageHeader
        crumbs={[
          { label: "Projects", href: "/dashboard" },
          { label: "Project", href: `/dashboard/projects/${id}` },
          { label: typedBuilding.name },
        ]}
        title={typedBuilding.name}
        subtitle={`${typedFloors.length} floors · ${allFlats.length} flats traced`}
        actions={<AddFloorButton buildingId={buildingId} projectId={id} />}
      />

      {typedFloors.length === 0 ? (
        <EmptyState title="No floors yet" body="Add a floor with its plate layout image, then trace the flats on it." />
      ) : (
        <div className="space-y-10">
          {typedFloors.map((floor) => {
            const flatsOnFloor = allFlats.filter((f) => f.floor_id === floor.id);
            return (
              <div key={floor.id} className="rounded-2xl border border-white/10 bg-[var(--map-panel)] p-4 sm:p-5">
                <h3 className="mb-3 font-semibold text-white">
                  {floorLabel(floor)} · {flatsOnFloor.length} flat(s)
                </h3>
                {floor.plan_image_url ? (
                  <FloorTracerClient
                    projectId={id}
                    buildingId={buildingId}
                    floorId={floor.id}
                    planImageUrl={floor.plan_image_url}
                    flats={flatsOnFloor}
                  />
                ) : (
                  <p className="text-sm text-gray-500">No plan image uploaded for this floor.</p>
                )}
                {flatsOnFloor.length > 0 && (
                  <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-gray-50 dark:bg-gray-900">
                        <tr>
                          <th className="p-2">Flat</th>
                          <th className="p-2">Wing</th>
                          <th className="p-2">BHK</th>
                          <th className="p-2">Carpet area</th>
                          <th className="p-2">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                        {flatsOnFloor.map((flat) => (
                          <tr key={flat.id}>
                            <td className="p-2 font-medium">{flat.unit_number}</td>
                            <td className="p-2">{flat.wing ?? "—"}</td>
                            <td className="p-2">{flat.bhk_type ?? "—"}</td>
                            <td className="p-2">
                              {flat.carpet_area_sqft ? `${flat.carpet_area_sqft.toLocaleString()} sq ft` : "—"}
                            </td>
                            <td className="p-2">
                              <StatusBadge status={flat.status} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
