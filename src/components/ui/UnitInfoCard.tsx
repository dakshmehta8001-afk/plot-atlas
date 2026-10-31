"use client";

// Compact floating card shown when a viewer clicks a unit on the map —
// styled after the MapBhoomi-style reference (status badge, zone/facing
// tags, area/size/rate stats, quick-contact icons, then the enquiry box).
// Works for both plots and flats: flat-only fields (BHK, carpet area, wing)
// only render when present. The enquiry logic itself (Google sign-in
// handoff, submit) lives in useEnquiryFlow so it isn't duplicated between
// UI styles.
import { useRef, useState } from "react";
import { useEnquiryFlow } from "@/lib/hooks/useEnquiryFlow";
import { UNIT_STATUS_STYLES, type Project, type Road, type Unit } from "@/lib/types";

// Kept to digits (and a leading +) since wa.me/tel: links don't tolerate
// spaces, dashes, or brackets in a phone number typed freeform in the
// dashboard.
function digitsOnly(phone: string): string {
  return phone.replace(/[^\d+]/g, "");
}

// Exported (and taking the three contact strings directly, rather than a
// whole Project) so SitePlanViewer's hover popup can render the exact
// same clickable icons without needing the full Project type threaded
// all the way down to it - only these three fields actually matter here.
export function QuickContactIcons({
  contactPhone,
  contactWhatsapp,
  contactEmail,
  unit,
  projectName,
  large = false,
}: {
  contactPhone: string | null;
  contactWhatsapp: string | null;
  contactEmail: string | null;
  unit: Unit;
  projectName: string;
  large?: boolean;
}) {
  const label = `${unit.wing ? `${unit.wing}-` : ""}${unit.unit_number}`;
  const btn = large
    ? "flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/75 hover:bg-white/15 hover:text-white [&>svg]:h-5 [&>svg]:w-5"
    : "flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-white/70 hover:bg-white/20 hover:text-white";
  const enquiryText = `Hi, I'm interested in ${label} at ${projectName}.`;

  if (!contactPhone && !contactWhatsapp && !contactEmail) return null;

  return (
    <div className="flex items-center gap-2">
      {contactPhone && (
        <a
          href={`tel:${digitsOnly(contactPhone)}`}
          title="Call"
          className={btn}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
            <path d="M6.6 10.8c1.4 2.7 3.6 4.9 6.3 6.3l2.1-2.1a1 1 0 0 1 1-.24 11 11 0 0 0 3.4.55 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1 11 11 0 0 0 .55 3.4 1 1 0 0 1-.24 1z" />
          </svg>
        </a>
      )}
      {contactWhatsapp && (
        <a
          href={`https://wa.me/${digitsOnly(contactWhatsapp).replace("+", "")}?text=${encodeURIComponent(enquiryText)}`}
          target="_blank"
          rel="noopener noreferrer"
          title="WhatsApp"
          className={btn}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
            <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.4A10 10 0 1 0 12 2zm0 2a8 8 0 0 1 6.7 12.4l-.3.5.3 1.9-2-.5-.5.2A8 8 0 0 1 12 4zm-2.9 4.4c-.2 0-.5.1-.6.3-.3.3-1 1-1 2.3s.9 2.7 1 2.9c.1.1 1.8 2.9 4.4 3.9 2.2.9 2.2.7 2.6.6.4-.1 1.3-.5 1.5-1s.2-.9.1-1c-.1-.1-.5-.3-1-.5s-1.3-.6-1.5-.7c-.2-.1-.4-.1-.5.1l-.7 1c-.1.2-.3.2-.5.1-1.1-.5-2.4-1.6-3-2.9-.1-.2 0-.4.1-.5l.4-.5c.1-.2.2-.4.1-.6l-.7-1.6c-.1-.2-.3-.4-.5-.4z" />
          </svg>
        </a>
      )}
      {contactEmail && (
        <a
          href={`mailto:${contactEmail}?subject=${encodeURIComponent(`Enquiry: ${label}, ${projectName}`)}&body=${encodeURIComponent(enquiryText)}`}
          title="Email"
          className={btn}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
            <path d="M2 5.5A1.5 1.5 0 0 1 3.5 4h17A1.5 1.5 0 0 1 22 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 18.5zm2.2.5 7.3 5.5a1 1 0 0 0 1 0L19.8 6zM20 8.1l-6.6 5a2.5 2.5 0 0 1-3 0l-6.4-5V18h16z" />
          </svg>
        </a>
      )}
    </div>
  );
}

// Returns the width label of the road whose centerline is nearest to the
// plot boundary — used as "road ahead" on the info card.
function nearestRoadWidth(unit: Unit, roads: Road[]): string | null {
  if (roads.length === 0 || unit.polygon_points.length < 3) return null;
  const pts = unit.polygon_points;
  // Edge midpoints as proxy for "plot boundary"
  const edgeMids = pts.map((p, i) => {
    const next = pts[(i + 1) % pts.length];
    return { x: (p.x + next.x) / 2, y: (p.y + next.y) / 2 };
  });
  let nearest: Road | null = null;
  let minDist = Infinity;
  for (const road of roads) {
    for (const rpt of road.path_points) {
      for (const em of edgeMids) {
        const d = Math.hypot(rpt.x - em.x, rpt.y - em.y);
        if (d < minDist) { minDist = d; nearest = road; }
      }
    }
  }
  return nearest?.width_label ?? null;
}

export function UnitInfoCard({
  unit,
  project,
  roads = [],
  isSignedIn,
  projectSlug,
  onClose,
}: {
  unit: Unit;
  project: Project;
  roads?: Road[];
  isSignedIn: boolean;
  projectSlug: string;
  onClose: () => void;
}) {
  const { message, setMessage, state, errorText, submit } = useEnquiryFlow(unit.id, isSignedIn, projectSlug);
  const statusStyle = UNIT_STATUS_STYLES[unit.status];

  const rate =
    unit.rate_per_sqft ?? (unit.total_price && unit.area_sqft ? Math.round(unit.total_price / unit.area_sqft) : null);

  const areaSqft = unit.unit_type === "flat" ? unit.carpet_area_sqft : unit.area_sqft;
  const areaSqm = areaSqft ? Math.round(areaSqft * 0.0929) : null;
  const roadWidth = nearestRoadWidth(unit, roads);
  const label = `${unit.unit_type === "flat" ? "Flat" : "Plot"} ${unit.wing ? `${unit.wing}-` : ""}${unit.unit_number}`;

  // Swipe-down-to-dismiss on the mobile sheet, driven from the grab handle
  // only so scrolling the sheet body never closes it by accident.
  const [dragY, setDragY] = useState(0);
  const dragStart = useRef<number | null>(null);

  return (
    <>
    <button
      type="button"
      aria-label="Close plot details"
      onClick={onClose}
      className="absolute inset-0 z-[850] bg-black/40 [animation:fadeIn_200ms_ease] sm:hidden"
    />
    <div
      role="dialog"
      aria-label={`${label} details`}
      style={dragY ? { transform: `translateY(${dragY}px)`, transition: "none" } : undefined}
      className="absolute inset-x-0 bottom-0 z-[900] flex max-h-[80%] flex-col rounded-t-[28px] border-t border-white/10 bg-[#0b1220]/95 text-white shadow-[0_-12px_40px_rgba(0,0,0,0.55)] backdrop-blur-xl transition-transform duration-200 [animation:settleIn_260ms_var(--ease-cinematic)] motion-reduce:animate-none sm:inset-x-auto sm:right-4 sm:top-4 sm:bottom-auto sm:z-[800] sm:max-h-[calc(100%-2rem)] sm:w-[340px] sm:rounded-3xl sm:border sm:[animation:slideInRight_280ms_ease]"
    >
      <div
        className="flex h-7 shrink-0 cursor-grab touch-none items-center justify-center sm:hidden"
        onPointerDown={(e) => { dragStart.current = e.clientY; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (dragStart.current !== null) setDragY(Math.max(0, e.clientY - dragStart.current)); }}
        onPointerUp={() => { const d = dragY; dragStart.current = null; setDragY(0); if (d > 90) onClose(); }}
        onPointerCancel={() => { dragStart.current = null; setDragY(0); }}
      >
        <span className="h-1 w-10 rounded-full bg-white/25" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4 sm:pt-5">
      {/* Header: identity + status, close */}
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-2xl font-bold leading-tight tracking-tight">{label}</p>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: statusStyle.border }} />
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: statusStyle.border }}>
              {statusStyle.label}
            </span>
            {unit.category && <span className="text-xs text-white/40">· {unit.category}</span>}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white/50 transition-colors hover:bg-white/10 hover:text-white"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      {/* Key facts — one divided grid, numbers first */}
      <dl className="mb-4 grid grid-cols-2 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] [&>div]:p-3.5 [&>div:nth-child(odd)]:border-r [&>div:nth-child(n+3)]:border-t [&>div]:border-white/10">
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Size</dt>
          <dd className="mt-1 text-[15px] font-semibold">{unit.dimensions ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Area</dt>
          <dd className="mt-1 text-[15px] font-semibold">
            {areaSqft ? `${areaSqft.toLocaleString()} sqft` : "—"}
            {areaSqm ? <span className="block text-xs font-normal text-white/45">{areaSqm.toLocaleString()} sqm</span> : null}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Facing</dt>
          <dd className="mt-1 text-[15px] font-semibold">{unit.facing ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Road ahead</dt>
          <dd className="mt-1 text-[15px] font-semibold">{roadWidth ?? "—"}</dd>
        </div>
      </dl>

      {/* Tags */}
      {unit.bhk_type && (
        <p className="mb-4 text-sm text-white/60">{unit.bhk_type}</p>
      )}

      {(rate || unit.total_price != null) && (
        <div className="mb-4 flex items-baseline justify-between gap-3">
          {unit.total_price != null ? (
            <p className="text-2xl font-bold tracking-tight">₹{unit.total_price.toLocaleString("en-IN")}</p>
          ) : <span />}
          {rate && <p className="text-xs text-white/45">₹{rate.toLocaleString("en-IN")} / sqft</p>}
        </div>
      )}

      {unit.description && (
        <p className="mb-4 whitespace-pre-wrap break-words text-sm leading-relaxed text-white/60">{unit.description}</p>
      )}

      {state !== "sent" && (
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Add a message (optional)"
          rows={2}
          className="w-full resize-none rounded-xl border border-white/10 bg-black/30 p-3 text-sm text-white placeholder:text-white/30 transition-colors focus:border-white/30 focus:outline-none"
        />
      )}
      </div>

      {/* Action bar — always visible at the bottom of the sheet */}
      <div className="shrink-0 border-t border-white/10 px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 sm:pb-4">
        {errorText && <p className="mb-2 text-xs text-red-400">{errorText}</p>}
        {state === "sent" ? (
          <p className="rounded-xl bg-green-500/15 p-3 text-center text-sm text-green-300">
            Thanks — your enquiry has been sent.
          </p>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={state === "submitting"}
              className="min-h-[48px] flex-1 rounded-xl bg-white px-4 text-sm font-bold text-[#030712] transition-transform active:scale-[0.98] disabled:opacity-60"
            >
              {state === "submitting" ? "Sending…" : "I'm interested"}
            </button>
            <QuickContactIcons
              contactPhone={project.contact_phone}
              contactWhatsapp={project.contact_whatsapp}
              contactEmail={project.contact_email}
              unit={unit}
              projectName={project.name}
              large
            />
          </div>
        )}
      </div>
    </div>
    </>
  );
}
