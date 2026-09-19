"use client";

// The MapBhoomi-style project map page: a fixed-height dark panel with a
// header/stats/zone-legend/compass overlaid on the map, a floating bottom
// tab bar (Media / About) that swaps the main content area, and a compact
// unit info card in place of a full-screen modal. Ties together
// BuildingDrilldown (the map + the bird's-eye-to-floor-view animation),
// MediaPanel/AboutPanel (the other two tabs), and UnitInfoCard (the enquiry
// flow) — the project page itself stays a Server Component that does the
// initial data fetch.
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BuildingDrilldown, type BuildingWithFloors } from "@/components/BuildingDrilldown";
import { MediaPanel } from "@/components/MediaPanel";
import { AboutPanel } from "@/components/AboutPanel";
import { Compass } from "@/components/Compass";
import { UnitInfoCard } from "@/components/UnitInfoCard";
import { PENDING_ENQUIRY_KEY } from "@/lib/useEnquiryFlow";
import { createLead } from "@/lib/actions/leads";
import {
  distinctZones,
  SITE_FEATURE_STYLES,
  zoneColorFor,
  type Project,
  type ProjectMedia,
  type Road,
  type SiteFeature,
  type Unit,
} from "@/lib/types";

type Tab = "map" | "media" | "about";

export function ProjectMapClient({
  project,
  plots,
  buildings,
  roads,
  features = [],
  unitsByFloor,
  allUnits,
  media,
  isSignedIn,
  ownerName,
}: {
  project: Project;
  plots: Unit[];
  buildings: BuildingWithFloors[];
  roads: Road[];
  features?: SiteFeature[];
  unitsByFloor: Record<string, Unit[]>;
  allUnits: Unit[];
  media: ProjectMedia[];
  isSignedIn: boolean;
  ownerName: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [selectedUnit, setSelectedUnit] = useState<Unit | null>(() => {
    const intent = searchParams.get("intent");
    const unitId = searchParams.get("unit");
    if (intent !== "enquire" || !unitId) return null;
    return allUnits.find((u) => u.id === unitId) ?? null;
  });
  const [autoSentNotice, setAutoSentNotice] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("map");
  const [drilldownStage, setDrilldownStage] = useState<"site" | "floor-select" | "floor-view">("site");
  const [zoneColourMode, setZoneColourMode] = useState(false);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);

  useEffect(() => {
    const intent = searchParams.get("intent");
    const unitId = searchParams.get("unit");
    if (intent !== "enquire" || !unitId) return;

    const raw = sessionStorage.getItem(PENDING_ENQUIRY_KEY);
    if (isSignedIn && raw) {
      try {
        const pending = JSON.parse(raw) as { unitId: string; message: string };
        if (pending.unitId === unitId) {
          sessionStorage.removeItem(PENDING_ENQUIRY_KEY);
          createLead(unitId, pending.message).then((result) => {
            if (!result.error) setAutoSentNotice("Your enquiry was sent after signing in.");
          });
        }
      } catch {
        // Malformed/stale sessionStorage entry — ignore it.
      }
    }

    router.replace(`/projects/${project.slug}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only run once on mount for this redirect-back case
  }, []);

  const zones = distinctZones(allUnits);
  const featureKindsPresent = Array.from(new Set(features.map((f) => f.kind)));
  const counts = {
    total: allUnits.length,
    available: allUnits.filter((u) => u.status === "available").length,
    hold: allUnits.filter((u) => u.status === "hold").length,
    booked: allUnits.filter((u) => u.status === "booked").length,
    sold: allUnits.filter((u) => u.status === "sold").length,
  };

  function toggleTab(tab: Tab) {
    setActiveTab((current) => (current === tab ? "map" : tab));
  }

  function toggleZone(zone: string) {
    setSelectedZone((current) => (current === zone ? null : zone));
    setZoneColourMode(true);
  }

  // Once drilled into a building, BuildingDrilldown shows its own back-
  // buttons and a "Tower A · 3rd Floor" breadcrumb in roughly the same
  // corner as this header/stats/legend overlay — showing both collides, so
  // this chrome steps aside until the viewer backs out to the full site.
  const showMapChrome = activeTab === "map" && drilldownStage === "site";

  return (
    <div className="relative h-[640px] w-full overflow-hidden rounded-xl border border-white/10 bg-[#0b1f2e]">
      {showMapChrome && (
        <>
          <div className="absolute left-4 top-4 z-[600] max-w-[65%]">
            {ownerName && (
              <p className="text-[11px] font-semibold uppercase tracking-widest text-blue-300/80">{ownerName}</p>
            )}
            <h1 className="text-2xl font-bold text-white drop-shadow">{project.name}</h1>
            {project.location && <p className="text-xs text-white/50">{project.location}</p>}
          </div>

          <div className="absolute left-4 top-[5.5rem] z-[600] flex flex-wrap gap-2">
            <Pill label="Total" value={counts.total} tone="neutral" />
            <Pill label="Available" value={counts.available} tone="green" />
            <Pill label="Hold" value={counts.hold} tone="yellow" />
            <Pill label="Booked" value={counts.booked} tone="blue" />
            <Pill label="Sold" value={counts.sold} tone="red" />
          </div>

          {zones.length > 0 && (
            <div className="absolute left-4 top-[8.5rem] z-[600] flex flex-wrap items-center gap-2">
              <label className="mr-1 flex items-center gap-1.5 text-[11px] text-white/60">
                <input
                  type="checkbox"
                  checked={zoneColourMode}
                  onChange={(e) => setZoneColourMode(e.target.checked)}
                  className="accent-blue-500"
                />
                Zone colours
              </label>
              {zones.map((zone) => (
                <button
                  key={zone}
                  onClick={() => toggleZone(zone)}
                  className="flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-opacity"
                  style={{
                    borderColor: zoneColorFor(zone, zones),
                    color: zoneColorFor(zone, zones),
                    opacity: selectedZone && selectedZone !== zone ? 0.4 : 1,
                  }}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: zoneColorFor(zone, zones) }} />
                  {zone}
                </button>
              ))}
            </div>
          )}

          {featureKindsPresent.length > 0 && (
            <div className="absolute left-4 top-[11.5rem] z-[600] flex flex-wrap items-center gap-2">
              {featureKindsPresent.map((kind) => {
                const style = SITE_FEATURE_STYLES[kind];
                return (
                  <span
                    key={kind}
                    className="flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium"
                    style={{ borderColor: style.border, color: style.border }}
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: style.border }} />
                    {style.label}
                  </span>
                );
              })}
            </div>
          )}

          <Compass />
        </>
      )}

      {autoSentNotice && (
        <p className="absolute bottom-16 left-1/2 z-[700] -translate-x-1/2 rounded-md bg-green-500/15 px-3 py-1.5 text-xs text-green-300">
          {autoSentNotice}
        </p>
      )}

      <div className="absolute inset-0">
        {activeTab === "media" ? (
          <MediaPanel media={media} />
        ) : activeTab === "about" ? (
          <AboutPanel project={project} />
        ) : !project.plan_image_url ? (
          <div className="flex h-full w-full items-center justify-center text-sm text-white/50">
            This project has no plan image uploaded yet.
          </div>
        ) : (
          <BuildingDrilldown
            planImageUrl={project.plan_image_url}
            plots={plots}
            buildings={buildings}
            roads={roads}
            features={features}
            unitsByFloor={unitsByFloor}
            onPlotClick={setSelectedUnit}
            onFlatClick={setSelectedUnit}
            colorMode={zoneColourMode ? "zone" : "status"}
            zones={zones}
            highlightZone={selectedZone}
            onStageChange={setDrilldownStage}
          />
        )}
      </div>

      {selectedUnit && (
        <UnitInfoCard
          unit={selectedUnit}
          project={project}
          isSignedIn={isSignedIn}
          projectSlug={project.slug}
          onClose={() => setSelectedUnit(null)}
        />
      )}

      <div className="absolute bottom-4 left-1/2 z-[600] flex -translate-x-1/2 gap-1 rounded-full bg-black/40 p-1 backdrop-blur">
        <TabButton label="Media" active={activeTab === "media"} onClick={() => toggleTab("media")} />
        <TabButton label="About" active={activeTab === "about"} onClick={() => toggleTab("about")} />
      </div>
    </div>
  );
}

function Pill({ label, value, tone }: { label: string; value: number; tone: "neutral" | "green" | "blue" | "yellow" | "red" }) {
  const toneClasses: Record<typeof tone, string> = {
    neutral: "border-white/20 text-white/80",
    green: "border-green-500/50 text-green-300",
    blue: "border-blue-500/50 text-blue-300",
    yellow: "border-yellow-500/50 text-yellow-300",
    red: "border-red-500/50 text-red-300",
  };
  return (
    <span className={`rounded-full border bg-black/30 px-2.5 py-0.5 text-[11px] font-medium ${toneClasses[tone]}`}>
      {label} <span className="font-bold">{value}</span>
    </span>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
        active ? "bg-white text-[#0b1f2e]" : "text-white/70 hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}
