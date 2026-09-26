"use client";

// The MapBhoomi-style project map page: a fixed-height dark panel laid out
// as a real two-row flex column — a dedicated header row (title/stats/
// zone-legend, own space, never overlapping) above a flex-1 map row (which
// carries the Compass, a floating bottom tab bar for Media/About, and a
// compact unit info card in place of a full-screen modal). Ties together
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
import { useCountUp } from "@/lib/useCountUp";
import {
  distinctZones,
  SITE_FEATURE_STYLES,
  zoneColorFor,
  type Project,
  type ProjectMedia,
  type Road,
  type SiteFeature,
  type Unit,
  type UnitStatus,
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
  const [statusFilter, setStatusFilter] = useState<UnitStatus | null>(null);

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

  function toggleStatus(status: UnitStatus) {
    setStatusFilter((current) => (current === status ? null : status));
  }

  // Once drilled into a building, BuildingDrilldown shows its own back-
  // buttons and a "Tower A · 3rd Floor" breadcrumb in roughly the same
  // corner as this header/stats/legend overlay — showing both collides, so
  // this chrome steps aside until the viewer backs out to the full site.
  const showMapChrome = activeTab === "map" && drilldownStage === "site";

  return (
    // A real two-row layout — a dedicated header row (only present at the
    // site stage, via showMapChrome) above a separate flex-1 row holding
    // the map/media/about content — rather than the header floating on top
    // of the map. This guarantees the header and the map can never
    // visually overlap regardless of a project's plan image aspect ratio
    // or how much header content there is (title length, zone/feature
    // legend, etc.): the header takes exactly the space its own content
    // needs, and the map row gets whatever's left, instead of both
    // occupying the same absolutely-positioned box and hoping they don't
    // collide. min-h-0 on the map row is required for flex-1 to actually
    // shrink below its content's natural size in a flex column — without
    // it the row refuses to give up space to the header row above it.
    //
    // No explicit height here (no h-full, no fixed h-[640px]) — the
    // project page's own <main> (src/app/projects/[slug]/page.tsx) is a
    // flex row filling the viewport below the nav bar, and its default
    // align-items: stretch already sizes this single flex child to the
    // container's full cross-size for free. An explicit height:100% here
    // actively fights that: it overrides the stretch default and instead
    // asks this element to resolve a PERCENTAGE against <main>'s height —
    // which measured out to just this panel's own content height (the
    // header row) instead of the full 847px available, because <main>
    // establishes its size via flex-grow (a resolved flex value) rather
    // than a literal CSS `height`, and that's exactly the combination
    // percentage-height resolution doesn't reliably handle. Dropping the
    // height utility and trusting stretch (confirmed via a live Playwright
    // check: this div's rendered height went from 149.5px to the full
    // 847px once removed) is what actually makes the map full-screen.
    // w-full is still needed, unlike height: width is <main>'s MAIN axis
    // (row direction), which flex-basis:auto sizes from content instead of
    // stretching — and this element's own children are absolutely
    // positioned, contributing ~0 to that content-based width.
    <div
      className="relative flex w-full flex-col overflow-hidden bg-[#0b1f2e]"
      // A one-time "digital twin powering on" entrance for the whole panel
      // when the project page first mounts — reuses the same settleIn
      // keyframe BuildingDrilldown's floor-select/floor-view panels already
      // use (a plain HTML element, so no SVG transform-box concerns), just
      // a touch slower/grander given this is the top-level container, not
      // a sub-panel. Plays once per mount; the reveal-in stagger on the
      // shapes THEMSELVES (SitePlanViewer/FloorPlanViewer) runs on their
      // own separate timeline right after, layering into one continuous
      // "map powers on, then draws itself in" opening sequence.
      style={{ animation: "settleIn 550ms var(--ease-cinematic)" }}
    >
      {showMapChrome && (
        <div className="flex-none border-b border-map-border bg-map-panel/60 px-3 py-2.5 sm:px-4">
          <div className="min-w-0">
            {ownerName && (
              <p className="truncate text-[10px] font-semibold uppercase tracking-widest text-blue-300/80">{ownerName}</p>
            )}
            <h1 className="truncate text-lg font-semibold text-white sm:text-xl">{project.name}</h1>
            {project.location && <p className="truncate text-[11px] text-white/50">{project.location}</p>}
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5">
            <Pill label="Total" value={counts.total} tone="neutral" />
            <StatusChip label="Available" value={counts.available} tone="green" active={statusFilter === "available"} onClick={() => toggleStatus("available")} />
            <StatusChip label="Hold" value={counts.hold} tone="yellow" active={statusFilter === "hold"} onClick={() => toggleStatus("hold")} />
            <StatusChip label="Booked" value={counts.booked} tone="blue" active={statusFilter === "booked"} onClick={() => toggleStatus("booked")} />
            <StatusChip label="Sold" value={counts.sold} tone="red" active={statusFilter === "sold"} onClick={() => toggleStatus("sold")} />
          </div>

          {(zones.length > 0 || featureKindsPresent.length > 0) && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {zones.length > 0 && (
                <>
                  <label className="mr-0.5 flex items-center gap-1.5 rounded-full bg-black/20 px-2 py-1 text-[10px] text-white/70">
                    <input
                      type="checkbox"
                      checked={zoneColourMode}
                      onChange={(e) => setZoneColourMode(e.target.checked)}
                      className="accent-blue-500"
                    />
                    Zone
                  </label>
                  {zones.map((zone) => (
                    <button
                      key={zone}
                      onClick={() => toggleZone(zone)}
                      className="flex items-center gap-1.5 rounded-full border bg-black/20 px-2 py-1 text-[11px] font-medium transition-opacity"
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
                </>
              )}
              {featureKindsPresent.map((kind) => {
                const style = SITE_FEATURE_STYLES[kind];
                return (
                  <span
                    key={kind}
                    className="flex items-center gap-1.5 rounded-full border bg-black/20 px-2 py-1 text-[11px] font-medium"
                    style={{ borderColor: style.border, color: style.border }}
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: style.border }} />
                    {style.label}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* A flex row rather than everything absolutely stacked in one box:
          UnitInfoCard becomes a real flex sibling of the map area on
          desktop (via its own sm:static override), so selecting a plot
          actually narrows the map canvas to make room for a docked side
          rail — not just a floating card visually on top of it. On mobile
          UnitInfoCard stays position:absolute (a bottom sheet, unaffected
          by this row being flex), so nothing here changes its appearance
          below the sm breakpoint. */}
      <div className="relative flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          {showMapChrome && <Compass />}

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
                highlightStatus={statusFilter}
                onStageChange={setDrilldownStage}
              />
            )}
          </div>

          <div className="absolute bottom-4 left-1/2 z-[600] flex -translate-x-1/2 gap-1 rounded-full bg-black/40 p-1 backdrop-blur">
            <TabButton label="Media" active={activeTab === "media"} onClick={() => toggleTab("media")} />
            <TabButton label="About" active={activeTab === "about"} onClick={() => toggleTab("about")} />
          </div>
        </div>

        {selectedUnit && (
          <UnitInfoCard
            // Remounts (resetting useEnquiryFlow's message/submit state and
            // replaying the docked panel's slide-in) whenever a DIFFERENT
            // unit is selected — without this, clicking straight from one
            // plot to another without closing the panel first would carry
            // over the previous plot's typed enquiry message or "sent"
            // state, a real latent bug that the docked rail (which
            // specifically invites clicking through several plots in a row
            // without closing) makes much more likely to actually surface.
            key={selectedUnit.id}
            unit={selectedUnit}
            project={project}
            isSignedIn={isSignedIn}
            projectSlug={project.slug}
            onClose={() => setSelectedUnit(null)}
          />
        )}
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
  // Counts up from 0 on first mount rather than appearing as a static
  // number — useCountUp itself checks prefers-reduced-motion and jumps
  // straight to the target for anyone who needs that.
  const displayValue = useCountUp(value);
  return (
    <span className={`rounded-full border bg-black/30 px-2.5 py-0.5 text-[11px] font-medium ${toneClasses[tone]}`}>
      {label} <span className="font-bold tabular-nums">{displayValue}</span>
    </span>
  );
}

// Like Pill, but clickable — toggles the map's status filter (dims every
// plot that doesn't match, via SitePlanViewer's highlightStatus prop).
// "Total" stays a plain Pill since there's no status value to filter by.
function StatusChip({
  label,
  value,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: number;
  tone: "green" | "blue" | "yellow" | "red";
  active: boolean;
  onClick: () => void;
}) {
  const toneClasses: Record<typeof tone, string> = {
    green: "border-green-500/50 text-green-300",
    blue: "border-blue-500/50 text-blue-300",
    yellow: "border-yellow-500/50 text-yellow-300",
    red: "border-red-500/50 text-red-300",
  };
  const displayValue = useCountUp(value);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${toneClasses[tone]} ${
        active ? "bg-white/20 ring-1 ring-white/50" : "bg-black/30 hover:bg-black/50"
      }`}
    >
      {label} <span className="font-bold tabular-nums">{displayValue}</span>
    </button>
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
