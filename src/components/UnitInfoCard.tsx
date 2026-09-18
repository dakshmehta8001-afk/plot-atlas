"use client";

// Compact floating card shown when a viewer clicks a unit on the map —
// styled after the MapBhoomi-style reference (status badge, zone/facing
// tags, area/size/rate stats, quick-contact icons, then the enquiry box).
// Works for both plots and flats: flat-only fields (BHK, carpet area, wing)
// only render when present. The enquiry logic itself (Google sign-in
// handoff, submit) lives in useEnquiryFlow so it isn't duplicated between
// UI styles.
import { useEnquiryFlow } from "@/lib/useEnquiryFlow";
import { UNIT_STATUS_STYLES, type Project, type Unit } from "@/lib/types";

// Kept to digits (and a leading +) since wa.me/tel: links don't tolerate
// spaces, dashes, or brackets in a phone number typed freeform in the
// dashboard.
function digitsOnly(phone: string): string {
  return phone.replace(/[^\d+]/g, "");
}

function QuickContactIcons({ project, unit }: { project: Project; unit: Unit }) {
  const label = `${unit.wing ? `${unit.wing}-` : ""}${unit.unit_number}`;
  const enquiryText = `Hi, I'm interested in ${label} at ${project.name}.`;

  if (!project.contact_phone && !project.contact_whatsapp && !project.contact_email) return null;

  return (
    <div className="flex items-center gap-2">
      {project.contact_phone && (
        <a
          href={`tel:${digitsOnly(project.contact_phone)}`}
          title="Call"
          className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-white/70 hover:bg-white/20 hover:text-white"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
            <path d="M6.6 10.8c1.4 2.7 3.6 4.9 6.3 6.3l2.1-2.1a1 1 0 0 1 1-.24 11 11 0 0 0 3.4.55 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1 11 11 0 0 0 .55 3.4 1 1 0 0 1-.24 1z" />
          </svg>
        </a>
      )}
      {project.contact_whatsapp && (
        <a
          href={`https://wa.me/${digitsOnly(project.contact_whatsapp).replace("+", "")}?text=${encodeURIComponent(enquiryText)}`}
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
      {project.contact_email && (
        <a
          href={`mailto:${project.contact_email}?subject=${encodeURIComponent(`Enquiry: ${label}, ${project.name}`)}&body=${encodeURIComponent(enquiryText)}`}
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
        <div className="flex items-center gap-2">
          <QuickContactIcons project={project} unit={unit} />
          <button onClick={onClose} className="text-white/50 hover:text-white">
            ✕
          </button>
        </div>
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
