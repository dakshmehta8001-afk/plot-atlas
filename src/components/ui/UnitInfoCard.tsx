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
    ? "flex h-12 min-w-12 flex-1 items-center justify-center border-2 border-[var(--ink)] bg-white text-[var(--ink)] transition-colors hover:bg-[var(--paper-2)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--signal)] [&>svg]:h-5 [&>svg]:w-5"
    : "flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-white/70 hover:bg-white/20 hover:text-white";
  const enquiryText = `Hi, I'm interested in ${label} at ${projectName}.`;

  if (!contactPhone && !contactWhatsapp && !contactEmail) return null;

  return (
    <div className={`flex items-center gap-2 ${large ? "w-full" : ""}`}>
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
// Status colours for the light sheet (the neon map colours are too pale on cream).
const STATUS_COLOR: Record<Unit["status"], string> = {
  available: "var(--st-available)",
  hold: "var(--st-hold)",
  booked: "var(--st-booked)",
  sold: "var(--st-sold)",
};

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

  const statusColor = STATUS_COLOR[unit.status];
  // Only rows that have a value: an empty plot sheet row says nothing.
  const spec = [
    { k: "Size", v: unit.dimensions },
    {
      k: "Area",
      v: areaSqft ? `${areaSqft.toLocaleString()} sq ft${areaSqm ? ` (${areaSqm.toLocaleString()} sq m)` : ""}` : null,
    },
    { k: "Facing", v: unit.facing ? <span className="capitalize">{unit.facing}</span> : null },
    { k: "Road", v: roadWidth },
  ].filter((r) => r.v);
  const [messageOpen, setMessageOpen] = useState(false);

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
      className="theme-survey absolute inset-x-0 bottom-0 z-[900] flex max-h-[62%] flex-col border-t-[3px] border-[var(--ink)] bg-white text-[var(--ink)] transition-transform duration-200 [animation:settleIn_260ms_var(--ease-cinematic)] motion-reduce:animate-none sm:inset-x-auto sm:right-4 sm:top-4 sm:bottom-auto sm:z-[800] sm:max-h-[calc(100%-2rem)] sm:w-[348px] sm:border-2 sm:shadow-[var(--hard)] sm:[animation:slideInRight_280ms_ease]"
    >
      <div
        className="flex h-6 shrink-0 cursor-grab touch-none items-center justify-center sm:hidden"
        onPointerDown={(e) => { dragStart.current = e.clientY; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (dragStart.current !== null) setDragY(Math.max(0, e.clientY - dragStart.current)); }}
        onPointerUp={() => { const d = dragY; dragStart.current = null; setDragY(0); if (d > 90) onClose(); }}
        onPointerCancel={() => { dragStart.current = null; setDragY(0); }}
      >
        <span className="h-1 w-10 bg-[var(--line)]" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 sm:pt-4">
      {/* Header: identity + status, close */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-label text-[26px] font-semibold uppercase leading-none tracking-tight">{label}</p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 border-[1.5px] px-2 py-0.5 font-label text-[12px] font-semibold uppercase tracking-[0.1em] text-[var(--ink)]"
              style={{ borderColor: statusColor }}
            >
              <span aria-hidden className="h-3 w-3" style={{ backgroundColor: statusColor }} />
              {statusStyle.label}
            </span>
            {unit.category && <span className="font-label text-[12px] uppercase tracking-[0.06em] text-[var(--ink-3)]">{unit.category}</span>}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center text-[var(--ink)] transition-colors hover:bg-[var(--paper-2)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--signal)]"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square" className="h-4 w-4">
            <path d="M5 5l14 14M19 5L5 19" />
          </svg>
        </button>
      </div>

      {/* Spec table: same rows, same order, on every plot */}
      <dl className="mb-3 border-2 border-[var(--ink)]">
        {spec.map((r) => (
          <div key={r.k} className="flex items-baseline justify-between gap-4 border-t border-[var(--line)] px-3 py-2 first:border-t-0">
            <dt className="font-label text-[12px] font-medium uppercase tracking-[0.08em] text-[var(--ink-3)]">{r.k}</dt>
            <dd className="text-right font-label text-[13px] font-medium">{r.v}</dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-4 border-t-2 border-[var(--ink)] bg-[var(--paper-2)] px-3 py-2.5">
          <dt className="font-label text-[12px] font-medium uppercase tracking-[0.08em] text-[var(--ink-3)]">Price</dt>
          <dd className="text-right">
            {unit.total_price != null ? (
              <>
                <span className="font-label text-[20px] font-semibold leading-none">₹{unit.total_price.toLocaleString("en-IN")}</span>
                {rate && <span className="mt-1 block font-label text-[12px] text-[var(--ink-3)]">₹{rate.toLocaleString("en-IN")} / sq ft</span>}
              </>
            ) : (
              <span className="font-label text-[13px] font-medium text-[var(--ink)]">On request<span className="mt-0.5 block text-[12px] font-normal text-[var(--ink-3)]">Ask the seller</span></span>
            )}
          </dd>
        </div>
      </dl>

      {unit.bhk_type && <p className="mb-3 font-label text-[12px] uppercase tracking-[0.06em] text-[var(--ink-2)]">{unit.bhk_type}</p>}

      {unit.description && (
        <p className="mb-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--ink-2)]">{unit.description}</p>
      )}

      {state !== "sent" &&
        (messageOpen || message ? (
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Add a message (optional)"
            rows={2}
            autoFocus={messageOpen}
            className="w-full resize-none border-2 border-[var(--ink)] bg-white p-3 text-sm text-[var(--ink)] placeholder:text-[var(--ink-3)] focus:outline-none focus-visible:ring-4 focus-visible:ring-[var(--signal)]"
          />
        ) : (
          <button
            type="button"
            onClick={() => setMessageOpen(true)}
            className="min-h-11 font-label text-[12px] font-medium uppercase tracking-[0.06em] text-[var(--ink-2)] underline underline-offset-4 hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--signal)]"
          >
            + Add a message
          </button>
        ))}
      </div>

      {/* Action bar: always visible at the bottom of the sheet */}
      <div className="shrink-0 border-t-2 border-[var(--ink)] px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 sm:pb-4">
        {errorText && <p role="alert" className="mb-2 font-label text-xs text-[#b3382a]">{errorText}</p>}
        {state === "sent" ? (
          <p className="border-2 border-[var(--st-available)] p-3 text-center font-label text-[13px] font-medium uppercase tracking-[0.04em] text-[var(--st-available)]">
            Enquiry sent. Thank you.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={state === "submitting"}
              className="flex min-h-[48px] w-full items-center justify-between whitespace-nowrap bg-[var(--accent)] px-4 font-label text-[13px] font-semibold uppercase tracking-[0.08em] text-[var(--accent-ink)] transition-colors hover:bg-[var(--ink-2)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--signal)] disabled:opacity-60"
            >
              {state === "submitting" ? "Sending…" : "I'm interested"}
              <span aria-hidden className="text-[var(--signal)]">→</span>
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
