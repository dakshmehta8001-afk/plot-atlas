"use client";

// Compact floating card shown when a viewer clicks a unit on the map —
// styled after the MapBhoomi-style reference (status badge, zone/facing
// tags, area/size/rate stats, quick-contact icons, then the enquiry box).
// Works for both plots and flats: flat-only fields (BHK, carpet area, wing)
// only render when present. The enquiry logic itself (Google sign-in
// handoff, submit) lives in useEnquiryFlow so it isn't duplicated between
// UI styles.
import { useEnquiryFlow } from "@/lib/hooks/useEnquiryFlow";
import { UNIT_STATUS_STYLES, type Project, type Unit } from "@/lib/types";

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
}: {
  contactPhone: string | null;
  contactWhatsapp: string | null;
  contactEmail: string | null;
  unit: Unit;
  projectName: string;
}) {
  const label = `${unit.wing ? `${unit.wing}-` : ""}${unit.unit_number}`;
  const enquiryText = `Hi, I'm interested in ${label} at ${projectName}.`;

  if (!contactPhone && !contactWhatsapp && !contactEmail) return null;

  return (
    <div className="flex items-center gap-2">
      {contactPhone && (
        <a
          href={`tel:${digitsOnly(contactPhone)}`}
          title="Call"
          className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-white/70 hover:bg-white/20 hover:text-white"
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
          className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-white/70 hover:bg-white/20 hover:text-white"
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
          className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-white/70 hover:bg-white/20 hover:text-white"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
            <path d="M2 5.5A1.5 1.5 0 0 1 3.5 4h17A1.5 1.5 0 0 1 22 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 18.5zm2.2.5 7.3 5.5a1 1 0 0 0 1 0L19.8 6zM20 8.1l-6.6 5a2.5 2.5 0 0 1-3 0l-6.4-5V18h16z" />
          </svg>
        </a>
      )}
    </div>
  );
}

export function UnitInfoCard({
  unit,
  project,
  isSignedIn,
  projectSlug,
  onClose,
}: {
  unit: Unit;
  project: Project;
  isSignedIn: boolean;
  projectSlug: string;
  onClose: () => void;
}) {
  const { message, setMessage, state, errorText, submit } = useEnquiryFlow(unit.id, isSignedIn, projectSlug);
  const statusStyle = UNIT_STATUS_STYLES[unit.status];

  const rate =
    unit.rate_per_sqft ?? (unit.total_price && unit.area_sqft ? Math.round(unit.total_price / unit.area_sqft) : null);

  return (
    <div className="absolute inset-x-0 bottom-0 z-[900] max-h-[75%] overflow-y-auto rounded-t-3xl border-t border-white/10 bg-[var(--map-panel)] p-5 pb-[calc(1rem+env(safe-area-inset-bottom))] text-white shadow-[0_-10px_40px_rgba(0,0,0,0.5)] backdrop-blur-xl sm:absolute sm:right-6 sm:top-24 sm:bottom-auto sm:z-[800] sm:h-auto sm:max-h-[calc(100%-8rem)] sm:w-80 sm:flex-none sm:rounded-3xl sm:border sm:border-white/10 sm:bg-[var(--map-panel)] sm:shadow-2xl sm:[animation:slideInRight_320ms_ease]">
      <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-white/20 sm:hidden" />
      <div className="mb-2 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold">
            {unit.wing ? `${unit.wing}-` : ""}
            {unit.unit_number}
          </span>
          <span
            className="rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest shadow-[0_0_10px_rgba(255,255,255,0.1)]"
            style={{ backgroundColor: statusStyle.fill, color: statusStyle.border, borderColor: statusStyle.border }}
          >
            {statusStyle.label}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <QuickContactIcons
            contactPhone={project.contact_phone}
            contactWhatsapp={project.contact_whatsapp}
            contactEmail={project.contact_email}
            unit={unit}
            projectName={project.name}
          />
          <button type="button" onClick={onClose} aria-label="Close" className="-m-1.5 p-1.5 text-white/50 hover:text-white">
            ✕
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5 border-b border-white/5 pb-4">
        <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] capitalize text-white/80 shadow-inner">
          {unit.unit_type}
        </span>
        {unit.bhk_type && (
          <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-white/80 shadow-inner">{unit.bhk_type}</span>
        )}
        {unit.category && (
          <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-white/80 shadow-inner">{unit.category}</span>
        )}
        {unit.facing && (
          <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-white/80 shadow-inner">
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
        <div className="mb-4 rounded-xl border border-white/10 bg-black/20 p-3 text-center shadow-inner">
          <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">Total Price</p>
          <p className="text-xl font-bold text-white tracking-tight">₹{unit.total_price.toLocaleString()}</p>
        </div>
      )}

      {state === "sent" ? (
        <p className="rounded-md bg-green-500/15 p-2 text-xs text-green-300">
          Thanks — your enquiry has been sent.
        </p>
      ) : (
        <div className="space-y-3">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Message (optional)"
            rows={2}
            className="w-full resize-none rounded-xl border border-white/10 bg-black/30 p-3 text-xs text-white placeholder:text-white/30 shadow-inner transition-colors focus:border-white/30 focus:outline-none focus:ring-0"
          />
          {errorText && <p className="text-xs text-red-400">{errorText}</p>}
          <button
            type="button"
            onClick={submit}
            disabled={state === "submitting"}
            className="w-full rounded-xl bg-white px-4 py-3 text-sm font-bold text-[#030712] transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-60 shadow-[0_0_20px_rgba(255,255,255,0.2)] hover:shadow-[0_0_25px_rgba(255,255,255,0.4)]"
          >
            {state === "submitting" ? "Sending…" : "I'm interested"}
          </button>
        </div>
      )}
    </div>
  );
}
