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
import { ProjectTracerClient } from "@/components/map/ProjectTracerClient";
import { PlanImageUpload } from "@/components/media/PlanImageUpload";
import { MediaManager } from "@/components/media/MediaManager";
import { PublishToggle } from "@/components/ui/PublishToggle";
import { RoadWidthList } from "@/components/dashboard/RoadWidthList";
import { ProjectDetailsForm } from "@/components/forms/ProjectDetailsForm";
import { StatusBadge, CategoryBadge } from "@/components/ui/StatusBadge";
import { sortByUnitNumber } from "@/lib/utils/sortUnits";
import { PageHeader, Section, btnSecondary, card } from "@/components/dashboard/PageHeader";
import type { Building, Project, ProjectMedia, Road, SiteFeature, Unit } from "@/lib/types";

export default async function ManageProjectPage(props: PageProps<"/dashboard/projects/[id]">) {
  const { id } = await props.params;
  const supabase = await createClient();

  const { data: project } = await supabase.from("projects").select("*").eq("id", id).single();
  if (!project) notFound();

  const [{ data: units }, { data: buildings }, { data: roads }, { data: features }, { data: media }] = await Promise.all([
    supabase.from("units").select("*").eq("project_id", id).order("unit_number"),
    supabase.from("buildings").select("*").eq("project_id", id).order("name"),
    supabase.from("roads").select("*").eq("project_id", id).order("created_at"),
    supabase.from("site_features").select("*").eq("project_id", id).order("created_at"),
    supabase.from("project_media").select("*").eq("project_id", id).order("sort_order"),
  ]);

  const typedProject = project as Project;
  const allUnits = sortByUnitNumber((units ?? []) as Unit[]);
  const plots = allUnits.filter((u) => u.unit_type === "plot");
  const flats = allUnits.filter((u) => u.unit_type === "flat");
  const typedBuildings = (buildings ?? []) as Building[];
  const typedRoads = (roads ?? []) as Road[];
  const typedFeatures = (features ?? []) as SiteFeature[];
  const typedMedia = (media ?? []) as ProjectMedia[];

  return (
    <div>
      <PageHeader
        crumbs={[{ label: "Projects", href: "/dashboard" }, { label: typedProject.name }]}
        title={typedProject.name}
        actions={
          <>
            <Link href={`/projects/${typedProject.slug}`} className={btnSecondary}>
              View live
            </Link>
            <Link href={`/dashboard/projects/${id}/leads`} className={btnSecondary}>
              Leads
            </Link>
            <Link href={`/dashboard/projects/${id}/place-on-map`} className={btnSecondary} title="Align plan with satellite map">
              {typedProject.map_bounds ? "Re-align satellite" : "Place on map"}
            </Link>
            <ProjectDetailsForm project={typedProject} />
            <PublishToggle projectId={id} status={typedProject.status} />
          </>
        }
      />

      <dl className="mb-8 grid grid-cols-3 gap-2 sm:grid-cols-5">
        {[
          ["Plots", plots.length],
          ["Buildings", typedBuildings.length],
          ["Flats", flats.length],
          ["Roads", typedRoads.length],
          ["Areas", typedFeatures.length],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-white/40">{label}</dt>
            <dd className="mt-0.5 text-xl font-bold tabular-nums text-white">{value}</dd>
          </div>
        ))}
      </dl>

      {/* No separate "Auto-digitize a plan" prompt here anymore — uploading
          a plan image (at project creation, or via PlanImageUpload below
          for a project that didn't have one yet) now goes straight into
          the auto-digitize flow itself (see createProject/PlanImageUpload's
          own redirects), so there's no longer a distinct "image uploaded,
          now go click a separate button to detect it" step for this page
          to prompt. The +Trace new plot/building/road tools on
          ProjectTracerClient below are UNCHANGED — still here for adding or
          correcting shapes by hand at any time. */}
      {typedProject.plan_image_url ? (
        <ProjectTracerClient
          projectId={id}
          planImageUrl={typedProject.plan_image_url}
          plots={plots}
          buildings={typedBuildings}
          roads={typedRoads}
          calibration={typedProject.map_calibration ?? null}
        />
      ) : (
        <PlanImageUpload projectId={id} />
      )}

      <RoadWidthList projectId={id} roads={typedRoads} />

      {typedBuildings.length > 0 && (
        <Section title="Buildings">
          <ul className={`${card} divide-y divide-white/5 overflow-hidden`}>
            {typedBuildings.map((building) => (
              <li key={building.id}>
                <Link
                  href={`/dashboard/projects/${id}/buildings/${building.id}`}
                  className="flex items-center justify-between gap-4 p-4 transition-colors hover:bg-white/[0.03]"
                >
                  <div>
                    <p className="font-medium text-white">{building.name}</p>
                    <p className="text-sm text-white/45">{building.total_floors ?? "—"} floors planned</p>
                  </div>
                  <span className="text-sm text-white/50">Floors and flats →</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {plots.length > 0 && (
        <Section title="Plots" description="Click a plot's polygon on the map above to edit it.">
          {/* Phone: cards */}
          <ul className="grid gap-2 sm:hidden">
            {plots.map((unit) => (
              <li key={unit.id} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="min-w-0">
                  <p className="font-semibold text-white">Plot {unit.unit_number}</p>
                  <p className="truncate text-xs text-white/45">
                    {[unit.dimensions, unit.area_sqft ? `${unit.area_sqft.toLocaleString()} sq ft` : null, unit.facing]
                      .filter(Boolean)
                      .join(" · ") || "No details"}
                  </p>
                </div>
                <StatusBadge status={unit.status} />
              </li>
            ))}
          </ul>
          <div className={`${card} hidden overflow-x-auto sm:block`}>
            <table className="w-full text-left text-sm">
              <thead className="border-b border-white/10 text-[11px] uppercase tracking-wider text-white/40">
                <tr>
                  <th className="p-3 font-semibold">Plot</th>
                  <th className="p-3 font-semibold">Area</th>
                  <th className="p-3 font-semibold">Size</th>
                  <th className="p-3 font-semibold">Facing</th>
                  <th className="p-3 font-semibold">Price</th>
                  <th className="p-3 font-semibold">Status</th>
                  <th className="p-3 font-semibold">Category</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-white/75">
                {plots.map((unit) => (
                  <tr key={unit.id} className="transition-colors hover:bg-white/[0.03]">
                    <td className="p-3 font-medium text-white">{unit.unit_number}</td>
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
        </Section>
      )}

      <Section title="Media gallery">
        <MediaManager projectId={id} media={typedMedia} />
      </Section>
    </div>
  );
}
