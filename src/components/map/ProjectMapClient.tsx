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
import { useCallback, useEffect, useState, lazy, Suspense } from "react";
import { useUpdateCheck } from "@/lib/hooks/useUpdateCheck";
const SatelliteView = lazy(() => import("./SatelliteView").then((m) => ({ default: m.SatelliteView })));
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { BuildingDrilldown, type BuildingWithFloors } from "@/components/dashboard/BuildingDrilldown";
import { MediaPanel } from "@/components/media/MediaPanel";
import { AboutPanel } from "@/components/ui/AboutPanel";
import { UnitInfoCard } from "@/components/ui/UnitInfoCard";
import { PENDING_ENQUIRY_KEY } from "@/lib/hooks/useEnquiryFlow";
import { createLead } from "@/lib/actions/leads";
import { useCountUp } from "@/lib/hooks/useCountUp";
import {
  SITE_FEATURE_STYLES,
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
  const hasUpdate = useUpdateCheck();

  const [selectedUnit, setSelectedUnit] = useState<Unit | null>(() => {
    const intent = searchParams.get("intent");
    const unitId = searchParams.get("unit");
    if (intent !== "enquire" || !unitId) return null;
    return allUnits.find((u) => u.id === unitId) ?? null;
  });
  const [autoSentNotice, setAutoSentNotice] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("map");
  const [drilldownStage, setDrilldownStage] = useState<"site" | "floor-select" | "floor-view">("site");
  const [statusFilter, setStatusFilter] = useState<UnitStatus | null>(null);
  const [mapView, setMapView] = useState<"plan" | "satellite">("plan");
  const hasSatellite = project.map_bounds !== null;

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

  function toggleStatus(status: UnitStatus) {
    setStatusFilter((current) => (current === status ? null : status));
  }

  // Once drilled into a building, BuildingDrilldown shows its own back-
  // buttons and a "Tower A · 3rd Floor" breadcrumb in roughly the same
  // corner as this header/stats/legend overlay — showing both collides, so
  // this chrome steps aside until the viewer backs out to the full site.
  // Esc closes the plot details panel (same as its close button).
  // Opening a plot card pushes one history entry, so the phone's Back
  // gesture closes the card instead of leaving the project page.
  const openUnit = useCallback((unit: Unit) => {
    if (!window.history.state?.plotCard) {
      window.history.pushState({ ...window.history.state, plotCard: true }, "");
    }
    setSelectedUnit(unit);
  }, []);

  const closeUnit = useCallback(() => {
    if (window.history.state?.plotCard) window.history.back();
    else setSelectedUnit(null);
  }, []);

  useEffect(() => {
    const onPop = () => setSelectedUnit(null);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (!selectedUnit) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeUnit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedUnit, closeUnit]);

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
    <>
    {hasUpdate && (
      <div className="fixed left-1/2 top-[calc(0.75rem+env(safe-area-inset-top))] z-[2000] flex -translate-x-1/2 items-center gap-3 rounded-full border border-white/15 bg-black/70 py-1 pl-4 pr-1 text-xs text-white/85 shadow-xl backdrop-blur-md">
        <span>New version available</span>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="min-h-[32px] rounded-full bg-white px-3 text-xs font-semibold text-[#030712] transition-transform active:scale-95"
        >
          Refresh
        </button>
      </div>
    )}
    <div
      className="relative flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-[var(--map-background)]"
      style={{ animation: "settleIn 280ms var(--ease-cinematic)" }}
    >
      {showMapChrome && (
        // A real row above the map, not an overlay: the plan is laid out in
        // the space below it, so no plot or control can sit underneath. The
        // chip row scrolls sideways instead of wrapping, which keeps the
        // band one fixed height at every width.
        <div className="relative z-[500] shrink-0 bg-[var(--map-background)]">
          <div className="flex items-center gap-2 px-3 py-2 sm:px-5">
            <Link
              href="/"
              aria-label="Back to projects"
              className="flex h-11 w-11 shrink-0 items-center justify-center border border-white/30 text-white/90 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--signal)]"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="square" className="h-4 w-4">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </Link>

            <div className="min-w-0 flex-1">
              {ownerName && (
                <p className="truncate font-label text-[12px] font-medium uppercase tracking-[0.08em] text-white/70">{ownerName}</p>
              )}
              <h1 className="truncate text-base font-semibold text-white">{project.name}</h1>
            </div>

            {hasSatellite && (
              <div className="flex shrink-0 border border-white/40 bg-black/60 p-0.5">
                {(["plan", "satellite"] as const).map((view) => (
                  <button
                    key={view}
                    type="button"
                    onClick={() => setMapView(view)}
                    aria-pressed={mapView === view}
                    className={`min-h-10 px-3 font-label text-[12px] font-semibold uppercase tracking-[0.08em] transition-colors pointer-coarse:min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--signal)] ${mapView === view ? "bg-white/20 text-white" : "text-white/60 hover:text-white"}`}
                  >
                    {view === "plan" ? "Plan" : "Sat"}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto px-3 pb-2 [scrollbar-width:none] sm:px-5 [&::-webkit-scrollbar]:hidden [&>*]:shrink-0">
            <span className="flex min-h-9 items-center border border-white/30 bg-black/55 px-2.5 font-label text-[12px] font-medium uppercase tracking-[0.04em] text-white/85 pointer-coarse:min-h-11">
              Total <span className="ml-1.5 font-bold tabular-nums">{counts.total}</span>
            </span>
            {(["available", "hold", "booked", "sold"] as const).map((status) => (
              <StatusChip
                key={status}
                status={status}
                label={status === "available" ? "Avail" : status === "hold" ? "Hold" : status === "booked" ? "Booked" : "Sold"}
                value={counts[status]}
                active={statusFilter === status}
                onClick={() => toggleStatus(status)}
              />
            ))}

            {featureKindsPresent.length > 0 && <span aria-hidden className="h-5 w-px bg-white/25" />}
            {featureKindsPresent.map((kind) => {
              const style = SITE_FEATURE_STYLES[kind];
              return (
                <span
                  key={kind}
                  className="flex min-h-9 items-center gap-1.5 border px-2.5 font-label text-[12px] font-medium uppercase tracking-[0.04em]"
                  style={{ borderColor: style.border, color: style.border }}
                >
                  <span aria-hidden className="h-2 w-2" style={{ backgroundColor: style.border }} />
                  {style.label}
                </span>
              );
            })}
          </div>
        </div>
      )}

      <div className="relative z-0 min-h-0 flex-1">
        <div className="absolute inset-0 min-w-0">
          {autoSentNotice && (
            <p className="absolute bottom-16 left-1/2 z-[700] -translate-x-1/2 rounded-md bg-green-500/20 px-4 py-2 text-sm font-medium text-green-300 backdrop-blur-md border border-green-500/20">
              {autoSentNotice}
            </p>
          )}

          <div className="absolute inset-0">
            {activeTab === "media" ? (
              <MediaPanel media={media} />
            ) : activeTab === "about" ? (
              <AboutPanel project={project} />
            ) : mapView === "satellite" && hasSatellite ? (
              <Suspense fallback={null}>
                <SatelliteView
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  alignment={project.map_bounds as any}
                  plots={plots}
                  roads={roads}
                  features={features}
                  highlightStatus={statusFilter}
                  onPlotClick={openUnit}
                />
              </Suspense>
            ) : !project.plan_image_url ? (
              <div className="flex h-full w-full items-center justify-center text-sm text-white/50">
                This project has no plan image uploaded yet.
              </div>
            ) : (
              <BuildingDrilldown
                planImageUrl={project.plan_image_url}
                planImageSize={{ width: project.plan_image_width, height: project.plan_image_height }}
                projectName={project.name}
                contactPhone={project.contact_phone}
                contactWhatsapp={project.contact_whatsapp}
                contactEmail={project.contact_email}
                plots={plots}
                buildings={buildings}
                roads={roads}
                features={features}
                unitsByFloor={unitsByFloor}
                onPlotClick={openUnit}
                onFlatClick={openUnit}
                colorMode="status"
                zones={[]}
                highlightZone={null}
                highlightStatus={statusFilter}
                calibration={project.map_calibration ?? null}
                onStageChange={setDrilldownStage}
              />
            )}
          </div>

          <div className="absolute bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 z-[600] flex -translate-x-1/2 gap-0.5 border border-white/40 bg-black/65 p-1 shadow-lg backdrop-blur-md">
            <TabButton label="Map" active={activeTab === "map"} onClick={() => setActiveTab("map")} />
            <TabButton label="Media" active={activeTab === "media"} onClick={() => toggleTab("media")} />
            <TabButton label="About" active={activeTab === "about"} onClick={() => toggleTab("about")} />
          </div>
        </div>

        {selectedUnit && (
          <UnitInfoCard
            key={selectedUnit.id}
            unit={selectedUnit}
            project={project}
            roads={roads}
            isSignedIn={isSignedIn}
            projectSlug={project.slug}
            onClose={closeUnit}
          />
        )}
      </div>

    </div>
    </>
  );
}

const STATUS_TONE: Record<UnitStatus, string> = {
  available: "border-green-500/50 text-green-300",
  hold: "border-yellow-500/50 text-yellow-300",
  booked: "border-blue-500/50 text-blue-300",
  sold: "border-red-500/50 text-red-300",
};

// Clickable chip that toggles the map's status filter (dims every plot that
// doesn't match, via SitePlanViewer's highlightStatus prop).
function StatusChip({
  status,
  label,
  value,
  active,
  onClick,
}: {
  status: UnitStatus;
  label: string;
  value: number;
  active: boolean;
  onClick: () => void;
}) {
  const displayValue = useCountUp(value);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex min-h-9 items-center border px-2.5 font-label text-[12px] font-medium uppercase tracking-[0.04em] transition-colors pointer-coarse:min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--signal)] ${STATUS_TONE[status]} ${
        active ? "bg-white/20 ring-1 ring-white/50" : "border-white/10 bg-black/35 hover:bg-black/55"
      }`}
    >
      {label} <span className="ml-1.5 font-bold tabular-nums">{displayValue}</span>
    </button>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-11 px-4 font-label text-[12px] font-semibold uppercase tracking-[0.1em] transition-colors ${
        active ? "bg-white text-[#030712]" : "text-white/75 hover:bg-white/10 hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}
