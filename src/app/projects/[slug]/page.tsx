// One project's public map view: fetches the project + its plots/buildings/
// floors/flats/media (all public-read per RLS once published), shapes them
// into the nested structure BuildingDrilldown expects, then hands off to
// ProjectMapClient — the MapBhoomi-style dark panel with the header/stats/
// legend overlay, the map/media/about tabs, and the "I'm interested" flow.
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProjectMapClient } from "@/components/ProjectMapClient";
import type { Building, Floor, Project, ProjectMedia, Road, SiteFeature, Unit } from "@/lib/types";
import type { BuildingWithFloors } from "@/components/BuildingDrilldown";

export default async function ProjectPage(props: PageProps<"/projects/[slug]">) {
  const { slug } = await props.params;
  const supabase = await createClient();

  const { data: project } = await supabase.from("projects").select("*").eq("slug", slug).single();
  if (!project) notFound();

  const [
    { data: units },
    { data: buildings },
    { data: floors },
    { data: roads },
    { data: features },
    { data: media },
    { data: userData },
    { data: ownerName },
  ] =
    await Promise.all([
      supabase.from("units").select("*").eq("project_id", project.id).order("unit_number"),
      supabase.from("buildings").select("*").eq("project_id", project.id).order("name"),
      supabase.from("floors").select("*, buildings!inner(project_id)").eq("buildings.project_id", project.id),
      supabase.from("roads").select("*").eq("project_id", project.id),
      supabase.from("site_features").select("*").eq("project_id", project.id),
      supabase.from("project_media").select("*").eq("project_id", project.id).order("sort_order"),
      supabase.auth.getUser(),
      // A SECURITY DEFINER function, not a plain users(name) embed — RLS has
      // no public-read policy on public.users (it would leak email/phone
      // too), so this returns only the name, only for the owning sub_admin.
      // See sub_admin_display_name() in the init_schema migration.
      supabase.rpc("sub_admin_display_name", { sub_admin_id: project.sub_admin_id }),
    ]);

  const allUnits = (units ?? []) as Unit[];
  const plots = allUnits.filter((u) => u.unit_type === "plot");
  const typedFloors = (floors ?? []) as Floor[];

  const unitsByFloor: Record<string, Unit[]> = {};
  for (const unit of allUnits) {
    if (unit.floor_id) (unitsByFloor[unit.floor_id] ??= []).push(unit);
  }

  const buildingsWithFloors: BuildingWithFloors[] = ((buildings ?? []) as Building[]).map((building) => ({
    ...building,
    floors: typedFloors.filter((f) => f.building_id === building.id),
  }));

  return (
    // The map is the main experience here, not a card embedded in a padded
    // page — flex-1 (with min-h-0, required for a flex child to shrink
    // below its content's natural size rather than refusing to give up
    // space) makes this <main> fill every pixel of vertical space `<body>`
    // (already a flex column, see layout.tsx) has left after the global
    // Nav bar, no magic pixel height needed. `w-full` still matters for
    // the same reason as before: ProjectMapClient's root is sized by
    // absolutely-positioned children, so without an explicit width a flex
    // item's default auto-sizing would shrink it to ~0 instead of
    // stretching.
    <main className="flex min-h-0 w-full flex-1">
      <ProjectMapClient
        project={project as Project}
        plots={plots}
        buildings={buildingsWithFloors}
        roads={(roads ?? []) as Road[]}
        features={(features ?? []) as SiteFeature[]}
        unitsByFloor={unitsByFloor}
        allUnits={allUnits}
        media={(media ?? []) as ProjectMedia[]}
        isSignedIn={!!userData.user}
        ownerName={ownerName ?? null}
      />
    </main>
  );
}
