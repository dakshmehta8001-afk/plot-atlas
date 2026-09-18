"use client";

// Compact floating card shown when a viewer clicks a unit on the map —
// styled after the MapBhoomi-style reference (status badge, zone/facing
// tags, area/size/rate stats, then the enquiry box). Works for both plots
// and flats: flat-only fields (BHK, carpet area, wing) only render when
// present. The enquiry logic itself (Google sign-in handoff, submit) lives
// in useEnquiryFlow so it isn't duplicated between UI styles.
import { useEnquiryFlow } from "@/lib/useEnquiryFlow";
import { UNIT_STATUS_STYLES, type Unit } from "@/lib/types";

export function UnitInfoCard({
  unit,
  isSignedIn,
  projectSlug,
  onClose,
}: {
  unit: Unit;
  isSignedIn: boolean;
  projectSlug: string;
  onClose: () => void;
}) {
  const { message, setMessage, state, errorText, submit } = useEnquiryFlow(unit.id, isSignedIn, projectSlug);
  const statusStyle = UNIT_STATUS_STYLES[unit.status];

  const rate =
    unit.rate_per_sqft ?? (unit.total_price && unit.area_sqft ? Math.round(unit.total_price / unit.area_sqft) : null);

  return (
    <div className="absolute left-4 top-44 z-[900] w-72 rounded-xl border border-white/10 bg-[#0f2436]/95 p-4 text-white shadow-2xl backdrop-blur">
      <div className="mb-2 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold">
            {unit.wing ? `${unit.wing}-` : ""}
            {unit.unit_number}
          </span>
          <span
            className="rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide"
            style={{ backgroundColor: statusStyle.fill, color: statusStyle.border }}
          >
            {statusStyle.label}
          </span>
        </div>
        <button onClick={onClose} className="text-white/50 hover:text-white">
          ✕
        </button>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] capitalize text-white/80">
          {unit.unit_type}
        </span>
        {unit.bhk_type && (
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/80">{unit.bhk_type}</span>
        )}
        {unit.category && (
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/80">{unit.category}</span>
        )}
        {unit.facing && (
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/80">
            Facing {unit.facing}
          </span>
        )}
      </div>

      <div className="mb-3 grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-white/40">
            {unit.unit_type === "flat" ? "Carpet area" : "Area"}
          </p>
          <p className="text-sm font-semibold">
            {unit.unit_type === "flat"
              ? unit.carpet_area_sqft
                ? `${unit.carpet_area_sqft.toLocaleString()} sqft`
                : "—"
              : unit.area_sqft
                ? `${unit.area_sqft.toLocaleString()} sqft`
                : "—"}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-white/40">Size</p>
          <p className="text-sm font-semibold">{unit.dimensions ?? "—"}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-white/40">Rate</p>
          <p className="text-sm font-semibold">{rate ? `₹${rate.toLocaleString()}/sqft` : "—"}</p>
        </div>
      </div>

      {unit.total_price != null && (
        <p className="mb-3 text-sm font-semibold text-white">₹{unit.total_price.toLocaleString()}</p>
      )}

      {state === "sent" ? (
        <p className="rounded-md bg-green-500/15 p-2 text-xs text-green-300">
          Thanks — your enquiry has been sent.
        </p>
      ) : (
        <div className="space-y-2">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Message (optional)"
            rows={2}
            className="w-full rounded-md border border-white/10 bg-white/5 p-2 text-xs text-white placeholder:text-white/30"
          />
          {errorText && <p className="text-xs text-red-400">{errorText}</p>}
          <button
            type="button"
            onClick={submit}
            disabled={state === "submitting"}
            className="w-full rounded-md bg-white px-3 py-1.5 text-sm font-medium text-[#0f2436] hover:bg-white/90 disabled:opacity-60"
          >
            {state === "submitting" ? "Sending…" : "I'm interested"}
          </button>
        </div>
      )}
    </div>
  );
}
