"use client";

// Phone-only bottom sheet that holds the zone controls (the Zone colour
// toggle, one pill per zone, and the site-feature legend), so the map header
// can stay one tidy row on a 380 px screen. Opened by the "Zones" button in
// ProjectMapClient's header; desktop keeps the pills inline and never renders
// this.
import { SITE_FEATURE_STYLES, zoneColorFor, type SiteFeatureKind } from "@/lib/types";

export function ZonesSheet({
  open,
  onClose,
  zones,
  featureKinds,
  zoneColourMode,
  onZoneColourMode,
  selectedZone,
  onToggleZone,
}: {
  open: boolean;
  onClose: () => void;
  zones: string[];
  featureKinds: SiteFeatureKind[];
  zoneColourMode: boolean;
  onZoneColourMode: (on: boolean) => void;
  selectedZone: string | null;
  onToggleZone: (zone: string) => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[900] sm:hidden" role="dialog" aria-modal="true" aria-label="Zones">
      <button type="button" aria-label="Close zones" className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="absolute inset-x-0 bottom-0 max-h-[75vh] overflow-y-auto rounded-t-2xl border-t border-map-border bg-map-panel p-4 pb-6 shadow-2xl"
        style={{ animation: "settleIn 250ms var(--ease-cinematic)" }}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Zones</h2>
          <button type="button" onClick={onClose} className="rounded-md bg-white/10 px-3 py-1.5 text-sm font-medium text-white">
            Done
          </button>
        </div>

        {zones.length > 0 && (
          <>
            <label className="mb-3 flex items-center gap-2 text-sm text-white/80">
              <input type="checkbox" checked={zoneColourMode} onChange={(e) => onZoneColourMode(e.target.checked)} className="h-4 w-4 accent-blue-500" />
              Colour plots by zone
            </label>
            <div className="flex flex-wrap gap-2">
              {zones.map((zone) => (
                <button
                  key={zone}
                  type="button"
                  onClick={() => onToggleZone(zone)}
                  className="flex items-center gap-2 rounded-full border bg-black/20 px-3 py-2 text-sm font-medium transition-opacity"
                  style={{
                    borderColor: zoneColorFor(zone, zones),
                    color: zoneColorFor(zone, zones),
                    opacity: selectedZone && selectedZone !== zone ? 0.45 : 1,
                  }}
                >
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: zoneColorFor(zone, zones) }} />
                  {zone}
                </button>
              ))}
            </div>
          </>
        )}

        {featureKinds.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-white/50">On this site</p>
            <div className="flex flex-wrap gap-2">
              {featureKinds.map((kind) => {
                const style = SITE_FEATURE_STYLES[kind];
                return (
                  <span
                    key={kind}
                    className="flex items-center gap-2 rounded-full border bg-black/20 px-3 py-1.5 text-sm font-medium"
                    style={{ borderColor: style.border, color: style.border }}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: style.border }} />
                    {style.label}
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
