"use client";

// Form for a single unit's (plot or flat) details — used both right after
// tracing a new polygon (mode="create") and when a sub-admin clicks an
// existing unit on the tracer to edit its status/price/etc (mode="edit").
// Sharing one form keeps the two flows' fields from drifting apart.
//
// Which kind of unit is being created is fixed by where the tracer that
// opened this form lives (the project's master plan traces plots, a
// building floor's plan traces flats) rather than a dropdown here — a plot
// can't have a floor/wing/BHK and a flat can't exist without one, so
// letting the caller decide up front keeps this form from needing to
// re-derive that.
import { useState } from "react";
import { createUnit, updateUnit, deleteUnit } from "@/lib/actions/units";
import { UNIT_STATUS_OPTIONS, UNIT_STATUS_STYLES, type PolygonPoint, type Unit, type UnitKind } from "@/lib/types";

interface CreateProps {
  mode: "create";
  projectId: string;
  unitType: UnitKind;
  buildingId?: string | null;
  floorId?: string | null;
  polygonPoints: PolygonPoint[];
  onClose: () => void;
  onSaved: () => void;
}

interface EditProps {
  mode: "edit";
  projectId: string;
  unit: Unit;
  onClose: () => void;
  onSaved: () => void;
}

export function UnitFormModal(props: CreateProps | EditProps) {
  const existing = props.mode === "edit" ? props.unit : null;
  const unitType = props.mode === "create" ? props.unitType : props.unit.unit_type;

  const [unitNumber, setUnitNumber] = useState(existing?.unit_number ?? "");
  const [wing, setWing] = useState(existing?.wing ?? "");
  const [bhkType, setBhkType] = useState(existing?.bhk_type ?? "");
  const [category, setCategory] = useState(existing?.category ?? "");
  const [facing, setFacing] = useState(existing?.facing ?? "");
  const [dimensions, setDimensions] = useState(existing?.dimensions ?? "");
  const [areaSqft, setAreaSqft] = useState(existing?.area_sqft?.toString() ?? "");
  const [carpetAreaSqft, setCarpetAreaSqft] = useState(existing?.carpet_area_sqft?.toString() ?? "");
  const [ratePerSqft, setRatePerSqft] = useState(existing?.rate_per_sqft?.toString() ?? "");
  const [totalPrice, setTotalPrice] = useState(existing?.total_price?.toString() ?? "");
  const [status, setStatus] = useState(existing?.status ?? "available");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const shared = {
      unit_number: unitNumber,
      wing: unitType === "flat" ? wing || null : null,
      bhk_type: unitType === "flat" ? bhkType || null : null,
      category: category || null,
      facing: facing || null,
      dimensions: dimensions || null,
      area_sqft: areaSqft ? Number(areaSqft) : null,
      carpet_area_sqft: unitType === "flat" && carpetAreaSqft ? Number(carpetAreaSqft) : null,
      rate_per_sqft: ratePerSqft ? Number(ratePerSqft) : null,
      total_price: totalPrice ? Number(totalPrice) : null,
    };

    const result =
      props.mode === "create"
        ? await createUnit(props.projectId, {
            ...shared,
            unit_type: unitType,
            building_id: props.buildingId ?? null,
            floor_id: props.floorId ?? null,
            polygon_points: props.polygonPoints,
          })
        : await updateUnit(props.unit.id, props.projectId, { ...shared, status });

    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    props.onSaved();
  }

  async function handleDelete() {
    if (props.mode !== "edit") return;
    if (!confirm(`Delete ${props.unit.unit_number}? This cannot be undone.`)) return;
    setSaving(true);
    const result = await deleteUnit(props.unit.id, props.projectId);
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    props.onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={props.onClose}>
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-3 rounded-lg bg-white p-6 shadow-xl dark:bg-gray-900"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {props.mode === "create"
              ? `New ${unitType}`
              : `Edit ${props.unit.wing ? `${props.unit.wing}-` : ""}${props.unit.unit_number}`}
          </h2>
          <button type="button" onClick={props.onClose} className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>

        <label className="block text-sm">
          {unitType === "flat" ? "Flat number" : "Plot number"}
          <input
            required
            value={unitNumber}
            onChange={(e) => setUnitNumber(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 p-2 dark:border-gray-700 dark:bg-gray-800"
          />
        </label>

        {unitType === "flat" && (
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              Wing
              <input
                value={wing ?? ""}
                onChange={(e) => setWing(e.target.value)}
                placeholder="e.g. B"
                className="mt-1 w-full rounded-md border border-gray-300 p-2 dark:border-gray-700 dark:bg-gray-800"
              />
            </label>
            <label className="block text-sm">
              BHK type
              <input
                value={bhkType ?? ""}
                onChange={(e) => setBhkType(e.target.value)}
                placeholder="e.g. 2BHK"
                className="mt-1 w-full rounded-md border border-gray-300 p-2 dark:border-gray-700 dark:bg-gray-800"
              />
            </label>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            {unitType === "flat" ? "Super built-up (sq ft)" : "Area (sq ft)"}
            <input
              type="number"
              value={areaSqft}
              onChange={(e) => setAreaSqft(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 p-2 dark:border-gray-700 dark:bg-gray-800"
            />
          </label>
          {unitType === "flat" && (
            <label className="block text-sm">
              Carpet area (sq ft)
              <input
                type="number"
                value={carpetAreaSqft}
                onChange={(e) => setCarpetAreaSqft(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 p-2 dark:border-gray-700 dark:bg-gray-800"
              />
            </label>
          )}
        </div>

        <label className="block text-sm">
          Dimensions
          <input
            value={dimensions ?? ""}
            onChange={(e) => setDimensions(e.target.value)}
            placeholder="e.g. 20' x 30'"
            className="mt-1 w-full rounded-md border border-gray-300 p-2 dark:border-gray-700 dark:bg-gray-800"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            Rate (₹/sq ft)
            <input
              type="number"
              value={ratePerSqft}
              onChange={(e) => setRatePerSqft(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 p-2 dark:border-gray-700 dark:bg-gray-800"
            />
          </label>
          <label className="block text-sm">
            Total price (₹)
            <input
              type="number"
              value={totalPrice}
              onChange={(e) => setTotalPrice(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 p-2 dark:border-gray-700 dark:bg-gray-800"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            Category / zone
            <input
              value={category ?? ""}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="premium / standard"
              className="mt-1 w-full rounded-md border border-gray-300 p-2 dark:border-gray-700 dark:bg-gray-800"
            />
          </label>
          {props.mode === "edit" && (
            <label className="block text-sm">
              Status
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as Unit["status"])}
                className="mt-1 w-full rounded-md border border-gray-300 p-2 dark:border-gray-700 dark:bg-gray-800"
              >
                {UNIT_STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {UNIT_STATUS_STYLES[s].label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <label className="block text-sm">
          Facing
          <input
            value={facing ?? ""}
            onChange={(e) => setFacing(e.target.value)}
            placeholder="e.g. West"
            className="mt-1 w-full rounded-md border border-gray-300 p-2 dark:border-gray-700 dark:bg-gray-800"
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex items-center justify-between pt-2">
          {props.mode === "edit" ? (
            <button type="button" onClick={handleDelete} className="text-sm text-red-600 hover:underline">
              Delete unit
            </button>
          ) : (
            <span />
          )}
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-60 dark:bg-white dark:text-gray-900"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
