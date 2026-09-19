"use client";

// The side panel for whichever shape is currently selected — label/number/
// width editing, plot status buttons, and feature-kind picking. This is
// where an OCR mistake or an unlabeled auto-detected shape actually gets
// corrected; the canvas itself only handles boundary geometry.
import { ROAD_WIDTH_PRESETS, SITE_FEATURE_KIND_OPTIONS, SITE_FEATURE_STYLES, UNIT_STATUS_OPTIONS, UNIT_STATUS_STYLES, type SiteFeatureKind, type UnitStatus } from "@/lib/types";
import { polygonAreaFraction } from "@/lib/svgPolygon";
import type { DetectedShape } from "@/lib/digitize/types";

export function ShapeDetailsPanel({
  shape,
  onChange,
  onDelete,
}: {
  shape: DetectedShape;
  onChange: (next: DetectedShape) => void;
  onDelete: () => void;
}) {
  const kindLabel = shape.kind === "plot" ? "Plot" : shape.kind === "road" ? "Road" : "Area";
  const areaFraction = shape.kind !== "road" ? polygonAreaFraction(shape.points) : null;

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center justify-between">
        <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
          {kindLabel}
        </span>
        {shape.source === "detected" && shape.confidence !== undefined && (
          <span className="text-xs text-gray-400" title="A rough automatic-detection confidence hint, not a guarantee — please verify.">
            {Math.round(shape.confidence * 100)}% confidence
          </span>
        )}
      </div>

      <label className="block text-sm">
        {shape.kind === "road" ? "Road width" : shape.kind === "feature" ? "Label" : "Plot number"}
        <input
          type="text"
          value={shape.label}
          onChange={(e) => onChange({ ...shape, label: e.target.value })}
          placeholder={shape.kind === "road" ? "e.g. 40 ft" : shape.kind === "feature" ? "e.g. Central Park" : "e.g. 38"}
          className="mt-1 w-full rounded-md border border-gray-300 p-2 dark:border-gray-700 dark:bg-gray-950"
        />
      </label>

      {shape.kind === "road" && (
        <div className="flex flex-wrap gap-1.5">
          {ROAD_WIDTH_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => onChange({ ...shape, label: preset })}
              className="rounded-full border border-gray-300 px-2.5 py-0.5 text-xs hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800"
            >
              {preset}
            </button>
          ))}
        </div>
      )}

      {shape.kind === "plot" && (
        <div>
          <p className="mb-1.5 text-sm">Status</p>
          <div className="flex flex-wrap gap-1.5">
            {UNIT_STATUS_OPTIONS.map((status) => {
              const style = UNIT_STATUS_STYLES[status as UnitStatus];
              const active = (shape.status ?? "available") === status;
              return (
                <button
                  key={status}
                  type="button"
                  onClick={() => onChange({ ...shape, status: status as UnitStatus })}
                  className="rounded-full border px-2.5 py-0.5 text-xs font-medium"
                  style={{
                    borderColor: style.border,
                    color: active ? "#fff" : style.border,
                    backgroundColor: active ? style.border : "transparent",
                  }}
                >
                  {style.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {shape.kind === "feature" && (
        <div>
          <p className="mb-1.5 text-sm">Type</p>
          <div className="flex flex-wrap gap-1.5">
            {SITE_FEATURE_KIND_OPTIONS.map((kind) => {
              const style = SITE_FEATURE_STYLES[kind as SiteFeatureKind];
              const active = shape.featureKind === kind;
              return (
                <button
                  key={kind}
                  type="button"
                  onClick={() => onChange({ ...shape, featureKind: kind as SiteFeatureKind })}
                  className="rounded-full border px-2.5 py-0.5 text-xs font-medium"
                  style={{
                    borderColor: style.border,
                    color: active ? "#fff" : style.border,
                    backgroundColor: active ? style.border : "transparent",
                  }}
                >
                  {style.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {areaFraction !== null && (
        <p className="text-xs text-gray-400">
          Relative size: {(areaFraction * 100).toFixed(2)}% of the plan image (a rough sizing hint only — this app has no
          real-world scale reference, so it can&apos;t be converted to sq ft automatically; enter that manually after saving).
        </p>
      )}

      <p className="text-xs text-gray-400">{shape.points.length} point(s) traced.</p>

      <button
        type="button"
        onClick={onDelete}
        className="mt-auto rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-100 dark:bg-red-950 dark:text-red-400"
      >
        Delete this shape
      </button>
    </div>
  );
}
