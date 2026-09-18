"use client";

// Orchestrates the "bird's-eye to floor view" experience requested in the
// spec, built as a purely 2D/CSS animation rather than a 3D engine or real
// street-view imagery (see the project-scope discussion in memory — no
// Street View coverage exists for private developments anyway, and a
// convincing 3D flythrough is a much larger effort than this first version
// calls for). Three stages:
//
//   1. "site"        — SitePlanViewer showing the whole project. Clicking a
//                       building zooms into its footprint, then hands off here.
//   2. "floor-select" — a vertical elevator-style floor list slides in over
//                       the zoomed-in building, letting the viewer pick a floor.
//   3. "floor-view"   — cross-fades to FloorPlanViewer for the chosen floor,
//                       showing that floor's traced flats.
//
// "Back" steps out one stage at a time; leaving floor-view or floor-select
// resets SitePlanViewer's zoom back to the full site via `resetSignal`.
import { useEffect, useState } from "react";
import type { Building, Floor, Road, Unit } from "@/lib/types";
import { floorLabel, sortFloors } from "@/lib/types";
import { SitePlanViewer } from "@/components/SitePlanViewer";
import { FloorPlanViewer } from "@/components/FloorPlanViewer";

export interface BuildingWithFloors extends Building {
  floors: Floor[];
}

type Stage =
  | { kind: "site" }
  | { kind: "floor-select"; building: BuildingWithFloors }
  | { kind: "floor-view"; building: BuildingWithFloors; floor: Floor };

export function BuildingDrilldown({
  planImageUrl,
  plots,
  buildings,
  roads = [],
  unitsByFloor,
  onPlotClick,
  onFlatClick,
  colorMode = "status",
  zones = [],
  highlightZone = null,
  onStageChange,
}: {
  planImageUrl: string;
  plots: Unit[];
  buildings: BuildingWithFloors[];
  roads?: Road[];
  unitsByFloor: Record<string, Unit[]>;
  onPlotClick: (unit: Unit) => void;
  onFlatClick: (unit: Unit) => void;
  colorMode?: "status" | "zone";
  zones?: string[];
  highlightZone?: string | null;
  /** Lets the parent (ProjectMapClient) hide its own site-level header/stats/
   * legend overlay once we're inside a building — otherwise that chrome
   * visually collides with this component's own back-buttons/breadcrumb. */
  onStageChange?: (stage: Stage["kind"]) => void;
}) {
  const [stage, setStage] = useState<Stage>({ kind: "site" });
  const [resetSignal, setResetSignal] = useState(0);

  useEffect(() => {
    onStageChange?.(stage.kind);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when the stage itself changes, not on every onStageChange identity
  }, [stage.kind]);

  function backToSite() {
    setStage({ kind: "site" });
    setResetSignal(Date.now());
  }

  return (
    <div className="relative h-full w-full">
      {/* SitePlanViewer stays mounted underneath every stage so the zoomed-in
          building footprint is still visible (softly dimmed) behind the
          floor selector / floor view overlays — it reads as "we're now
          inside that building" rather than a jarring page swap. */}
      <div className={stage.kind === "site" ? "h-full w-full" : "h-full w-full opacity-40 pointer-events-none"}>
        <SitePlanViewer
          planImageUrl={planImageUrl}
          plots={plots}
          buildings={buildings}
          roads={roads}
          onPlotClick={onPlotClick}
          onBuildingSettled={(building) => {
            const withFloors = buildings.find((b) => b.id === building.id);
            if (withFloors) setStage({ kind: "floor-select", building: withFloors });
          }}
          colorMode={colorMode}
          zones={zones}
          highlightZone={highlightZone}
          resetSignal={resetSignal}
        />
      </div>

      {stage.kind === "floor-select" && (
        <div className="animate-[fadeIn_300ms_ease] absolute inset-0 z-20 flex items-center justify-center bg-black/40">
          <div className="w-64 rounded-xl border border-white/10 bg-[#0f2436]/95 p-4 text-white shadow-2xl backdrop-blur">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold">{stage.building.name}</h3>
              <button onClick={backToSite} className="text-white/50 hover:text-white">
                ✕
              </button>
            </div>
            <p className="mb-2 text-xs uppercase tracking-wide text-white/40">Select a floor</p>
            <div className="max-h-80 space-y-1 overflow-y-auto">
              {sortFloors(stage.building.floors)
                .slice()
                .reverse()
                .map((floor) => (
                  <button
                    key={floor.id}
                    onClick={() => setStage({ kind: "floor-view", building: stage.building, floor })}
                    className="flex w-full items-center justify-between rounded-md bg-white/5 px-3 py-2 text-sm hover:bg-white/15"
                  >
                    <span>{floorLabel(floor)}</span>
                    <span className="text-white/40">{(unitsByFloor[floor.id] ?? []).length} units</span>
                  </button>
                ))}
              {stage.building.floors.length === 0 && (
                <p className="px-3 py-2 text-sm text-white/50">No floors added for this building yet.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {stage.kind === "floor-view" && (
        <div className="animate-[fadeIn_300ms_ease] absolute inset-0 z-20">
          <div className="absolute left-3 top-3 z-10 flex gap-2">
            <button
              type="button"
              onClick={() => setStage({ kind: "floor-select", building: stage.building })}
              className="rounded-md bg-white/90 px-3 py-1.5 text-sm font-medium text-[#0f2436] shadow hover:bg-white"
            >
              ← Floors
            </button>
            <button
              type="button"
              onClick={backToSite}
              className="rounded-md bg-white/90 px-3 py-1.5 text-sm font-medium text-[#0f2436] shadow hover:bg-white"
            >
              ← Site plan
            </button>
          </div>
          <div className="absolute left-3 top-14 z-10 rounded-md bg-white/90 px-3 py-1 text-xs font-medium text-[#0f2436] shadow">
            {stage.building.name} · {floorLabel(stage.floor)}
          </div>
          {stage.floor.plan_image_url ? (
            <FloorPlanViewer
              planImageUrl={stage.floor.plan_image_url}
              flats={unitsByFloor[stage.floor.id] ?? []}
              onFlatClick={onFlatClick}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-[#0b1f2e] text-sm text-white/50">
              No floor plan image uploaded yet for this floor.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
