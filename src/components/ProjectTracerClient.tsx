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
import { PolygonTracer, type TracerShape } from "@/components/PolygonTracer";
import { UnitFormModal } from "@/components/UnitFormModal";
import { BuildingFormModal } from "@/components/BuildingFormModal";
import { RoadFormModal } from "@/components/RoadFormModal";
import { deleteRoad } from "@/lib/actions/roads";
import { UNIT_STATUS_STYLES, type Building, type PolygonPoint, type Road, type Unit } from "@/lib/types";

export function ProjectTracerClient({
  projectId,
  planImageUrl,
  plots,
  buildings,
  roads,
}: {
  projectId: string;
  planImageUrl: string;
  plots: Unit[];
  buildings: Building[];
  roads: Road[];
}) {
  const [newPlotPolygon, setNewPlotPolygon] = useState<PolygonPoint[] | null>(null);
  const [newBuildingPolygon, setNewBuildingPolygon] = useState<PolygonPoint[] | null>(null);
  const [newRoadPath, setNewRoadPath] = useState<PolygonPoint[] | null>(null);
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null);
  const router = useRouter();

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
        ]}
      />

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
