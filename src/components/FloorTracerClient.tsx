"use client";

// Client wrapper for a single floor's tracer: ties PolygonTracer to
// UnitFormModal, always creating/editing unit_type="flat" units scoped to
// this building+floor. Mirrors ProjectTracerClient's shape but simpler —
// a floor only ever traces one kind of shape (a flat).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PolygonTracer, type TracerShape } from "@/components/PolygonTracer";
import { UnitFormModal } from "@/components/UnitFormModal";
import { UNIT_STATUS_STYLES, type PolygonPoint, type Unit } from "@/lib/types";

export function FloorTracerClient({
  projectId,
  buildingId,
  floorId,
  planImageUrl,
  flats,
}: {
  projectId: string;
  buildingId: string;
  floorId: string;
  planImageUrl: string;
  flats: Unit[];
}) {
  const [newPolygon, setNewPolygon] = useState<PolygonPoint[] | null>(null);
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null);
  const router = useRouter();

  function handleSaved() {
    setNewPolygon(null);
    setEditingUnit(null);
    router.refresh();
  }

  const shapes: TracerShape[] = flats.map((unit) => ({
    id: unit.id,
    points: unit.polygon_points,
    fill: UNIT_STATUS_STYLES[unit.status].fill,
    stroke: UNIT_STATUS_STYLES[unit.status].border,
    label: `${unit.wing ? `${unit.wing}-` : ""}${unit.unit_number}`,
  }));

  return (
    <>
      <PolygonTracer
        planImageUrl={planImageUrl}
        shapes={shapes}
        onSelectShape={(id) => setEditingUnit(flats.find((f) => f.id === id) ?? null)}
        traceActions={[{ label: "+ Trace new flat", onComplete: setNewPolygon }]}
      />

      {newPolygon && (
        <UnitFormModal
          mode="create"
          projectId={projectId}
          unitType="flat"
          buildingId={buildingId}
          floorId={floorId}
          polygonPoints={newPolygon}
          onClose={() => setNewPolygon(null)}
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
