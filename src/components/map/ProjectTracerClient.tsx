"use client";

// Client wrapper for the master site-plan tracer: ties PolygonTracer
// (drawing) to two different follow-up forms depending on which "trace"
// button the sub-admin used — UnitFormModal (a plot) or BuildingFormModal
// (a building footprint) — and to UnitFormModal again for editing an
// existing plot. Clicking an existing building on the tracer navigates to
// its own manage page (buildings/floors/flats live there) rather than
// opening an edit modal here.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PolygonTracer, type TracerShape } from "@/components/map/PolygonTracer";
import { UnitFormModal } from "@/components/forms/UnitFormModal";
import { BuildingFormModal } from "@/components/forms/BuildingFormModal";
import { RoadFormModal } from "@/components/forms/RoadFormModal";
import { deleteRoad } from "@/lib/actions/roads";
import { calibrateProjectFromPlan } from "@/lib/actions/projects";
import { computeDimensionFields } from "@/lib/image/calibration";
import { useImageAspectRatio } from "@/lib/hooks/useImageAspectRatio";
import { MAP_VIEWBOX_SIZE, UNIT_STATUS_STYLES, type Building, type MapCalibration, type PolygonPoint, type Road, type Unit } from "@/lib/types";

export function ProjectTracerClient({
  projectId,
  planImageUrl,
  plots,
  buildings,
  roads,
  calibration,
}: {
  projectId: string;
  planImageUrl: string;
  plots: Unit[];
  buildings: Building[];
  roads: Road[];
  calibration: MapCalibration | null;
}) {
  const [newPlotPolygon, setNewPlotPolygon] = useState<PolygonPoint[] | null>(null);
  const [newBuildingPolygon, setNewBuildingPolygon] = useState<PolygonPoint[] | null>(null);
  const [newRoadPath, setNewRoadPath] = useState<PolygonPoint[] | null>(null);
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null);
  // "Set scale": the two clicked points, waiting for the real distance.
  const [scalePoints, setScalePoints] = useState<PolygonPoint[] | null>(null);
  const [scaleFeet, setScaleFeet] = useState("");
  const [scaleError, setScaleError] = useState<string | null>(null);
  const [scaleSaving, setScaleSaving] = useState(false);
  const aspectRatio = useImageAspectRatio(planImageUrl);
  const router = useRouter();

  async function saveScale() {
    if (!scalePoints) return;
    const feet = Number(scaleFeet);
    if (!(feet > 0)) {
      setScaleError("Enter the real distance in feet, greater than 0.");
      return;
    }
    const next: MapCalibration = {
      pointA: scalePoints[0],
      pointB: scalePoints[1],
      realDistanceFt: feet,
      northAngleDegrees: calibration?.northAngleDegrees ?? null,
    };
    // Same aspect-ratio convention as the digitize screen (see calibration.ts).
    const vbHeight = MAP_VIEWBOX_SIZE / aspectRatio;
    const plotSizes = plots.map((u) => {
      const f = computeDimensionFields(u.polygon_points, next, MAP_VIEWBOX_SIZE, vbHeight);
      return { id: u.id, dimensions: f.dimensions ?? null, areaSqft: f.areaSqft ?? null, needsDimensionReview: f.needsDimensionReview };
    });
    setScaleSaving(true);
    setScaleError(null);
    const result = await calibrateProjectFromPlan(projectId, next, plotSizes);
    setScaleSaving(false);
    if (result.error) {
      setScaleError(result.error);
      return;
    }
    setScalePoints(null);
    setScaleFeet("");
    router.refresh();
  }

  function handleSaved() {
    setNewPlotPolygon(null);
    setNewBuildingPolygon(null);
    setNewRoadPath(null);
    setEditingUnit(null);
    router.refresh();
  }

  const shapes: TracerShape[] = [
    ...plots.map((unit) => ({
      id: unit.id,
      points: unit.polygon_points,
      fill: UNIT_STATUS_STYLES[unit.status].fill,
      stroke: UNIT_STATUS_STYLES[unit.status].border,
      label: unit.unit_number,
    })),
    ...buildings.map((building) => ({
      id: building.id,
      points: building.polygon_points,
      fill: "rgba(99,102,241,0.35)",
      stroke: "#6366f1",
      label: building.name,
    })),
    ...roads.map((road) => ({
      id: road.id,
      points: road.path_points,
      fill: "none",
      stroke: "#f5c94b",
      label: `${road.width_label} road`,
      kind: "line" as const,
    })),
  ];

  async function handleSelectShape(id: string) {
    const plot = plots.find((p) => p.id === id);
    if (plot) {
      setEditingUnit(plot);
      return;
    }
    const road = roads.find((r) => r.id === id);
    if (road) {
      if (confirm(`Delete this ${road.width_label} road? Trace it again with a new width if you need to correct it.`)) {
        await deleteRoad(road.id, projectId);
        router.refresh();
      }
      return;
    }
    // Buildings are managed on their own page (floors + flats live there),
    // not in a modal over the site plan.
    router.push(`/dashboard/projects/${projectId}/buildings/${id}`);
  }

  return (
    <>
      <PolygonTracer
        planImageUrl={planImageUrl}
        shapes={shapes}
        onSelectShape={handleSelectShape}
        traceActions={[
          { label: "+ Trace new plot", onComplete: setNewPlotPolygon },
          { label: "+ Trace new building", onComplete: setNewBuildingPolygon },
          { label: "+ Trace road", shapeKind: "line", onComplete: setNewRoadPath },
          {
            label: calibration ? "Change scale" : "Set scale",
            shapeKind: "line",
            pointCount: 2,
            hint: "Click two points a known distance apart — e.g. both ends of the scale bar, or both edges of a road with a printed width",
            onComplete: (pts) => {
              setScaleError(null);
              setScalePoints(pts);
            },
          },
        ]}
      />
      <p className="mt-2 text-xs text-gray-500">
        {calibration
          ? `Scale set: the reference line is ${calibration.realDistanceFt} ft. Plot sizes are calculated from it.`
          : "No scale yet. Use Set scale so plot sizes can be calculated. It's required before publishing."}
      </p>

      {scalePoints && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl dark:bg-gray-900">
            <h2 className="text-lg font-semibold">Real distance between the two points</h2>
            <p className="mt-1 text-sm text-gray-500">For example, 100 for the 0′–100′ scale bar, or 30 across a 30′ wide road.</p>
            <div className="mt-4 flex items-center gap-2">
              <input
                type="number"
                min="0"
                step="any"
                autoFocus
                value={scaleFeet}
                onChange={(e) => setScaleFeet(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveScale()}
                className="w-full rounded-md border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-800"
                placeholder="Distance"
              />
              <span className="text-sm text-gray-600">ft</span>
            </div>
            {scaleError && <p className="mt-2 text-sm text-red-600">{scaleError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setScalePoints(null)} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:underline">
                Cancel
              </button>
              <button
                type="button"
                onClick={saveScale}
                disabled={scaleSaving}
                className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-60"
              >
                {scaleSaving ? "Saving…" : "Save scale"}
              </button>
            </div>
          </div>
        </div>
      )}

      {newPlotPolygon && (
        <UnitFormModal
          mode="create"
          projectId={projectId}
          unitType="plot"
          polygonPoints={newPlotPolygon}
          onClose={() => setNewPlotPolygon(null)}
          onSaved={handleSaved}
        />
      )}

      {newBuildingPolygon && (
        <BuildingFormModal
          projectId={projectId}
          polygonPoints={newBuildingPolygon}
          onClose={() => setNewBuildingPolygon(null)}
          onSaved={handleSaved}
        />
      )}

      {newRoadPath && (
        <RoadFormModal
          projectId={projectId}
          pathPoints={newRoadPath}
          onClose={() => setNewRoadPath(null)}
          onSaved={handleSaved}
        />
      )}

      {editingUnit && (
        <UnitFormModal
          mode="edit"
          projectId={projectId}
          unit={editingUnit}
          onClose={() => setEditingUnit(null)}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}
