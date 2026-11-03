"use client";

// "Visualise your home": the buyer's own plot drawn to scale, with a house on
// it, the cars that fit, a garden, optional Vastu zones and a nameplate with
// their family name. Square, survey-sheet styling to match the rest of the app
// (see .theme-survey in globals.css). Nothing here moves on its own; the only
// motion is a short rise when the house changes.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Project, Unit } from "@/lib/types";
import {
  CAR_L,
  CAR_W,
  REAR_GAP,
  SIDE_GAP,
  defaultFootprint,
  floorsLabel,
  homeLayout,
  normaliseFacing,
  parsePlotSize,
  rotationForFacing,
  toGaj,
  vastuPlacement,
} from "@/lib/plotVisual";

const fmt = (n: number) => Math.round(n).toLocaleString("en-IN");
const ZONE_FILL: Record<string, string> = { NE: "#2F5D8A", SE: "#C2410C", SW: "#7A3E9D", NW: "#1F7A4D" };

function Chip({ on, children, ...rest }: { on: boolean; children: React.ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-pressed={on}
      {...rest}
      className={`min-h-10 border-2 border-[var(--ink)] px-3 font-label text-[12px] font-semibold uppercase tracking-[0.06em] transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--signal)] disabled:cursor-not-allowed disabled:opacity-40 ${
        on ? "bg-[var(--ink)] text-white" : "bg-white text-[var(--ink)] hover:bg-[var(--paper-2)]"
      }`}
    >
      {children}
    </button>
  );
}

function Title({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 font-label text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--ink-3)]">{children}</h3>;
}

export function PlotVisualizer({
  unit,
  project,
  roadFt,
  onClose,
  onUsePlan,
}: {
  unit: Unit;
  project: Project;
  /** Width of the road in front, in feet, when known. */
  roadFt: number | null;
  onClose: () => void;
  /** Called with a one-line summary of the buyer's plan to add to their enquiry. */
  onUsePlan: (summary: string) => void;
}) {
  const plot = useMemo(() => parsePlotSize(unit), [unit]);
  const facing = normaliseFacing(unit.facing);
  const [wanted, setWanted] = useState(() => (plot ? defaultFootprint(plot) : 0));
  const [upper, setUpper] = useState(1);
  const [cars, setCars] = useState(1);
  const [garden, setGarden] = useState(true);
  const [vastu, setVastu] = useState(false);
  const [name, setName] = useState("");
  const [lang, setLang] = useState<"en" | "hi">("en");
  const closeRef = useRef<HTMLButtonElement>(null);
  const label = `${unit.wing ? `${unit.wing}-` : ""}${unit.unit_number}`;

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const L = useMemo(() => (plot ? homeLayout(plot, wanted) : null), [plot, wanted]);

  // Rendered into <body>: the plot sheet it opens from has a transform (its slide-in
  // animation), which would otherwise trap a fixed full-screen panel inside the sheet.
  const shell = (children: React.ReactNode) =>
    createPortal(
    <div role="dialog" aria-modal="true" aria-label={`Visualise your home on plot ${label}`} className="theme-survey paper-grid fixed inset-0 z-[3000] overflow-y-auto text-[var(--ink)]">
      <div className="sticky top-0 z-10 flex h-14 items-center justify-between border-b-2 border-[var(--ink)] bg-[var(--paper)] px-4">
        <button ref={closeRef} type="button" onClick={onClose} className="flex min-h-11 items-center gap-2 font-label text-[12px] font-semibold uppercase tracking-[0.1em] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--signal)]">
          <span aria-hidden>←</span> Back to plot {label}
        </button>
        <span className="hidden font-label text-[11px] uppercase tracking-[0.1em] text-[var(--ink-3)] sm:block">{project.name}</span>
      </div>
      {children}
    </div>,
    document.body,
  );

  if (!plot || !L) {
    return shell(
      <div className="mx-auto max-w-md px-6 py-20 text-center">
        <p className="font-display text-xl font-bold">This plot has no size saved yet</p>
        <p className="mt-2 text-[15px] text-[var(--ink-2)]">Ask the developer for its size, then the plot can be drawn to scale.</p>
      </div>,
    );
  }

  /* ---- drawing, in feet. The plot sits at (M, M); the road runs along the bottom ---- */
  const M = 7;
  const F = plot.frontage;
  const D = plot.depth;
  const road = Math.min(roadFt ?? 30, 40);
  const W = F + 2 * M;
  const H = M + D + road + 5;
  const houseX = M + (F - L.houseW) / 2;
  const houseY = M + L.houseTop;
  const drawCars = Math.min(cars, L.cars);
  const theta = facing ? rotationForFacing(facing) : 0;
  const shadow = (upper + 1) * 1.3;
  const plateName = name.trim() || (lang === "hi" ? "आपका नाम" : "Your name");
  const plateText = lang === "hi" ? `${plateName} निवास` : `${plateName} Residence`;
  const plateFont = Math.min(1.9, 10 / (plateText.length * 0.62));
  const totalBuilt = L.footprint * (upper + 1);
  const gaj = toGaj(plot.area);
  const slots = Array.from({ length: drawCars }, (_, i) => ({ col: i % Math.max(1, L.cols), row: Math.floor(i / Math.max(1, L.cols)) }));
  const planSummary = `Home plan: ${floorsLabel(upper)}, ${fmt(L.footprint)} sq ft per floor (${fmt(totalBuilt)} sq ft built-up), ${drawCars} car${drawCars === 1 ? "" : "s"}.${name.trim() ? ` Nameplate: ${plateText}.` : ""}`;

  function share() {
    const text = `${name.trim() ? `${name.trim()}'s ` : "My "}home on plot ${label} at ${project.name}: ${F}′ × ${D}′ (${fmt(plot!.area)} sq ft, ${fmt(gaj)} gaj). ${floorsLabel(upper)}, ${fmt(L!.footprint)} sq ft per floor. ${window.location.href}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  }

  return shell(
    <div className="mx-auto grid max-w-5xl gap-6 px-4 py-5 md:grid-cols-[minmax(0,440px)_minmax(0,1fr)]">
      <div className="sticky top-14 z-10 self-start border-2 border-[var(--ink)] bg-white p-2 shadow-[var(--hard)] md:top-20">
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-[36vh] w-full md:h-auto" role="img" aria-label={`Plot ${label} drawn to scale with a ${floorsLabel(upper)} house of ${fmt(L.footprint)} square feet per floor`}>
          <style>{`@keyframes rise{from{transform:translateY(2px) scale(.96);opacity:.2}to{transform:none;opacity:1}} .rise{transform-box:fill-box;transform-origin:50% 100%;animation:rise .35s ease-out} @media (prefers-reduced-motion: reduce){.rise{animation:none}}`}</style>
          <rect x="0" y="0" width={W} height={H} fill="#E4EEE4" />
          <rect x="0" y={M + D} width={W} height={road + 5} fill="#C9D1D7" />
          <path d={`M0 ${M + D + road / 2}H${W}`} stroke="#fff" strokeWidth=".45" strokeDasharray="3 3" />
          <rect x={M} y={M} width={F} height={D} fill="#F7FAF5" stroke="#0F2A3D" strokeWidth=".6" />

          {/* dimension lines */}
          <g stroke="#C2410C" fill="#C2410C" strokeWidth=".3">
            <path d={`M${M} 3.4H${M + F}M${M} 2.6V4.2M${M + F} 2.6V4.2`} />
            <text x={M + F / 2} y="2.4" textAnchor="middle" fontSize="2.4" stroke="none" fontFamily="var(--font-plex-mono), monospace">{F}′</text>
            <path d={`M3.4 ${M}V${M + D}M2.6 ${M}H4.2M2.6 ${M + D}H4.2`} />
            <text transform={`translate(2.2 ${M + D / 2}) rotate(-90)`} textAnchor="middle" fontSize="2.4" stroke="none" fontFamily="var(--font-plex-mono), monospace">{D}′</text>
          </g>

          {/* trees in the side gaps */}
          {garden && (
            <g>
              <circle cx={M + 2} cy={M + D * 0.35} r="2.1" fill="#2F8F5B" opacity=".9" />
              <circle cx={M + F - 2} cy={M + D * 0.55} r="2.1" fill="#2F8F5B" opacity=".9" />
              <circle cx={M + 2} cy={M + D * 0.62} r="1.5" fill="#4FA874" opacity=".9" />
            </g>
          )}

          {/* the house */}
          {L.footprint > 0 && (
            <g key={`${L.footprint}-${upper}`} className="rise">
              <rect x={houseX - shadow} y={houseY + shadow * 0.6} width={L.houseW} height={L.houseD} fill="#0F2A3D" opacity=".22" />
              <rect x={houseX} y={houseY} width={L.houseW} height={L.houseD} fill="#E8D6B8" stroke="#7A6548" strokeWidth=".4" />
              <rect x={houseX} y={houseY} width={L.houseW} height={L.houseD / 2} fill="#C2410C" />
              <rect x={houseX} y={houseY + L.houseD / 2} width={L.houseW} height={L.houseD / 2} fill="#9F3409" />
              <path d={`M${houseX} ${houseY + L.houseD / 2}H${houseX + L.houseW}`} stroke="#6E2306" strokeWidth=".4" />
              <rect x={M + F / 2 - 1.5} y={houseY + L.houseD - 0.7} width="3" height="1.4" fill="#5A4630" />
              {L.houseD > 7 && (
                <>
                  <text x={M + F / 2} y={houseY + L.houseD / 2 - 0.6} textAnchor="middle" fontSize="2.7" fontWeight="600" fill="#fff" fontFamily="var(--font-plex-mono), monospace">{floorsLabel(upper)}</text>
                  <text x={M + F / 2} y={houseY + L.houseD / 2 + 2.6} textAnchor="middle" fontSize="2.2" fill="#fff" fontFamily="var(--font-plex-mono), monospace">{fmt(L.footprint)} sq ft</text>
                </>
              )}
            </g>
          )}

          {/* tulsi planter by the door */}
          {garden && L.footprint > 0 && (
            <g>
              <rect x={M + F / 2 + 3} y={houseY + L.houseD + 0.8} width="2.2" height="2.2" fill="#fff" stroke="#7A6548" strokeWidth=".3" />
              <circle cx={M + F / 2 + 4.1} cy={houseY + L.houseD + 1.9} r=".9" fill="#2F8F5B" />
            </g>
          )}

          {/* parked cars, true size, nose toward the house */}
          {slots.map((s, i) => (
            <g key={i} transform={`translate(${M + 1 + CAR_W / 2 + s.col * (CAR_W + 0.5)} ${M + D - 0.8 - CAR_L / 2 - s.row * (CAR_L + 1)}) rotate(-90)`}>
              <rect x={-CAR_L / 2} y={-CAR_W / 2} width={CAR_L} height={CAR_W} rx="1.5" fill={["#C8352B", "#2F5D8A", "#E8E4DA"][i % 3]} stroke="#000" strokeOpacity=".35" strokeWidth=".3" />
              <rect x="0" y={-CAR_W / 2 + 0.6} width="5" height={CAR_W - 1.2} rx=".8" fill="#1B2A38" opacity=".85" />
              <rect x={-CAR_L / 2 + 1.5} y={-CAR_W / 2 + 0.6} width="2.4" height={CAR_W - 1.2} rx=".6" fill="#1B2A38" opacity=".8" />
            </g>
          ))}

          {/* Vastu zones, only when the plot's facing is known */}
          {vastu && facing && (
            <g>
              {vastuPlacement(facing).map((z) => {
                const x = z.h === "left" ? M : M + F / 2;
                const y = z.v === "top" ? M : M + D / 2;
                const fs = Math.min(1.7, (F / 2 - 2) / (z.text.length * 0.6));
                const pw = Math.max(5, z.text.length * fs * 0.6 + 1.8);
                const cx = x + F / 4;
                const cy = y + D / 4;
                return (
                  <g key={z.corner}>
                    <rect x={x} y={y} width={F / 2} height={D / 2} fill={ZONE_FILL[z.corner]} opacity=".2" stroke={ZONE_FILL[z.corner]} strokeWidth=".35" strokeDasharray="1.6 1.2" />
                    <rect x={cx - pw / 2} y={cy - 2.8} width={pw} height="5.6" fill="#fff" opacity=".9" stroke={ZONE_FILL[z.corner]} strokeWidth=".25" />
                    <text x={cx} y={cy - 0.2} textAnchor="middle" fontSize="2.6" fontWeight="700" fill={ZONE_FILL[z.corner]} fontFamily="var(--font-plex-mono), monospace">{z.corner}</text>
                    <text x={cx} y={cy + 2.1} textAnchor="middle" fontSize={fs} fontWeight="600" fill="#0F2A3D" fontFamily="var(--font-plex-mono), monospace">{z.text}</text>
                  </g>
                );
              })}
            </g>
          )}

          {/* compound wall and gate */}
          <rect x={M} y={M} width={F} height={D} fill="none" stroke="#5F5A50" strokeWidth=".9" />
          <rect x={M + F / 2 - 3.2} y={M + D - 0.7} width="6.4" height="1.4" fill="#F7FAF5" />

          {/* road label, nameplate on the footpath side of the wall */}
          <text x={W / 2} y={M + D + road / 2 + 3.6} textAnchor="middle" fontSize="2.4" fill="#4F6B80" letterSpacing=".4" fontFamily="var(--font-plex-mono), monospace">{roadFt ?? 30} FT ROAD</text>
          <g>
            <rect x={M + F - 12.4} y={M + D + 0.6} width="11.4" height="3.3" fill="#0F2A3D" stroke="#fff" strokeWidth=".3" />
            <text x={M + F - 6.7} y={M + D + 2.75 + plateFont * 0.25} textAnchor="middle" fontSize={plateFont} fill="#fff" fontWeight="700">{plateText}</text>
          </g>

          {facing && (
            <g transform={`translate(${W - 3.4} 4.4)`}>
              <circle r="2.7" fill="#fff" stroke="#0F2A3D" strokeWidth=".35" />
              <g transform={`rotate(${theta})`}><path d="M0 -2.1L.85 .9L0 .45L-.85 .9Z" fill="#C2410C" /></g>
            </g>
          )}
        </svg>
        <p className="px-1 pt-2 font-label text-[10px] uppercase tracking-[0.08em] text-[var(--ink-3)]">
          Drawn to scale on a simple rectangle. Road at the bottom.{facing ? ` Plot faces ${facing}. The arrow points north.` : ""}
        </p>
      </div>

      <div className="min-w-0 space-y-5 pb-28">
        <div className="border-2 border-[var(--ink)] bg-white p-4">
          <Title>Your plot</Title>
          <p className="font-label text-[26px] font-semibold uppercase leading-none">Plot {label}</p>
          <p className="mt-2 font-label text-[13px]">
            {F}′ × {D}′ · {fmt(plot.area)} sq ft · {fmt(gaj)} gaj
          </p>
          <p className="mt-1 text-[13px] text-[var(--ink-2)]">{facing ? `Faces ${facing}.` : "Facing not set for this plot."}</p>
        </div>

        <div className="border-2 border-[var(--ink)] bg-white p-4">
          <Title>Build</Title>
          <label htmlFor="foot" className="block text-[14px]">
            House on each floor: <b className="font-label">{fmt(L.footprint)} sq ft</b>
          </label>
          <input
            id="foot"
            type="range"
            min={Math.min(200, L.maxFootprint)}
            max={L.maxFootprint}
            step={50}
            value={L.footprint}
            onChange={(e) => setWanted(Number(e.target.value))}
            className="mt-1 h-8 w-full accent-[#0F2A3D]"
          />
          <p className="text-[12px] text-[var(--ink-3)]">The most that fits, leaving {SIDE_GAP} ft at the sides, {REAR_GAP} ft at the back and room at the front: {fmt(L.maxFootprint)} sq ft.</p>
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Floors">
            {[0, 1, 2].map((u) => (
              <Chip key={u} on={upper === u} onClick={() => setUpper(u)}>
                {floorsLabel(u)}
              </Chip>
            ))}
          </div>
          <dl className="mt-4 grid grid-cols-3 border-2 border-[var(--ink)] text-center">
            <div className="p-2"><dd className="font-label text-[17px] font-semibold">{fmt(totalBuilt)}</dd><dt className="font-label text-[9px] uppercase tracking-[0.08em] text-[var(--ink-3)]">sq ft built-up</dt></div>
            <div className="border-l border-[var(--line)] p-2"><dd className="font-label text-[17px] font-semibold">{fmt(L.openLand)}</dd><dt className="font-label text-[9px] uppercase tracking-[0.08em] text-[var(--ink-3)]">sq ft open land</dt></div>
            <div className="border-l border-[var(--line)] p-2"><dd className="font-label text-[17px] font-semibold">{L.cars}</dd><dt className="font-label text-[9px] uppercase tracking-[0.08em] text-[var(--ink-3)]">cars fit in front</dt></div>
          </dl>
          <p className="mb-1 mt-3 text-[14px]">Cars you own</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Cars you own">
            {[0, 1, 2, 3].map((c) => (
              <Chip key={c} on={drawCars === c} disabled={c > L.cars} onClick={() => setCars(c)}>
                {c}
              </Chip>
            ))}
          </div>
          {L.cars === 0 && L.footprint > 0 && <p className="mt-2 text-[13px] text-[#8f2a1f]">No car fits in front of a house this deep. Try a smaller footprint.</p>}
        </div>

        <div className="border-2 border-[var(--ink)] bg-white p-4">
          <Title>Make it yours</Title>
          <label htmlFor="nm" className="block text-[14px]">Name on the nameplate</label>
          <input
            id="nm"
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 24))}
            placeholder={lang === "hi" ? "आपका परिवार का नाम" : "Your family name"}
            autoComplete="off"
            className="mt-1 w-full border-2 border-[var(--ink)] bg-white px-3 py-2.5 text-[15px] placeholder:text-[var(--ink-3)]/70 focus:outline-none focus-visible:ring-4 focus-visible:ring-[var(--signal)]"
          />
          <div className="mt-2 flex gap-2" role="group" aria-label="Nameplate language">
            <Chip on={lang === "en"} onClick={() => setLang("en")}>English</Chip>
            <Chip on={lang === "hi"} onClick={() => setLang("hi")}>हिन्दी</Chip>
          </div>
          <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Extras">
            <Chip on={garden} onClick={() => setGarden((g) => !g)}>Garden and tulsi</Chip>
            <Chip on={vastu && !!facing} disabled={!facing} onClick={() => setVastu((v) => !v)}>Vastu zones</Chip>
          </div>
          <p className="mt-2 text-[12px] text-[var(--ink-3)]">
            {facing
              ? "Vastu zones show traditional guidance for those who follow it. They do not change the plot."
              : "Vastu zones need this plot's facing, which has not been set yet."}
          </p>
        </div>

        <p className="text-[12px] leading-relaxed text-[var(--ink-3)]">
          This is a picture to help you imagine the plot, not a building plan. Setbacks, ground coverage and height depend on local rules, so check them with the developer or your architect before you plan.
        </p>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t-2 border-[var(--ink)] bg-[var(--paper)] px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3">
        <div className="mx-auto flex max-w-5xl gap-2">
          <button type="button" onClick={share} className="flex min-h-12 flex-1 items-center justify-between bg-[#1F7A4D] px-4 font-label text-[12px] font-semibold uppercase tracking-[0.08em] text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--signal)]">
            Share on WhatsApp <span aria-hidden>→</span>
          </button>
          <button type="button" onClick={() => onUsePlan(planSummary)} className="flex min-h-12 flex-1 items-center justify-between bg-[var(--accent)] px-4 font-label text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--accent-ink)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--signal)]">
            Add to my enquiry <span aria-hidden className="text-[var(--signal)]">→</span>
          </button>
        </div>
      </div>
    </div>,
  );
}
