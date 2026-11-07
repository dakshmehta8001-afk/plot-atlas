// "About" tab content for a project's public page: developer/location
// details plus a legend explaining status colours and building markers.
// A location saved as a Maps link becomes a "Open in Maps" button rather
// than being printed as a raw URL. Drawn as a Survey Sheet panel: paper
// ground, ink border, hard shadow, mono labels.
import type { Project, UnitStatus } from "@/lib/types";
import { UNIT_STATUS_STYLES } from "@/lib/types";

function Swatch({ status }: { status: UnitStatus }) {
  return <span aria-hidden className="h-4 w-4 shrink-0 border border-[var(--ink)]" style={{ backgroundColor: UNIT_STATUS_STYLES[status].border }} />;
}

export function AboutPanel({ project }: { project: Project }) {
  const loc = project.location?.trim() ?? "";
  const locIsUrl = /^https?:\/\//i.test(loc);

  return (
    <div className="flex h-full w-full items-start justify-center overflow-y-auto px-4 pb-28 pt-6 sm:items-center">
      <section
        aria-label="About this project"
        className="theme-survey w-full max-w-md border-2 border-[var(--ink)] bg-white text-[var(--ink)] shadow-[var(--hard)]"
      >
        <header className="border-b-2 border-[var(--ink)] px-4 py-4">
          {project.developer_name && (
            <p className="mb-1 font-label text-[12px] font-medium uppercase tracking-[0.08em] text-[var(--ink-3)]">{project.developer_name}</p>
          )}
          <h2 className="text-2xl font-semibold tracking-tight">{project.name}</h2>
          {loc && !locIsUrl && <p className="mt-1 text-sm text-[var(--ink-2)]">{loc}</p>}
          {locIsUrl && (
            <a
              href={loc}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex min-h-11 items-center gap-2 border-2 border-[var(--ink)] px-4 font-label text-[12px] font-semibold uppercase tracking-[0.08em] transition-colors hover:bg-[var(--paper-2)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--signal)]"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                <path d="M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11z" />
                <circle cx="12" cy="10" r="2.5" />
              </svg>
              Open in Maps
            </a>
          )}
        </header>

        {project.description && (
          <p className="border-b border-[var(--line)] px-4 py-4 text-sm leading-relaxed text-[var(--ink-2)]">{project.description}</p>
        )}

        <div className="px-4 py-4">
          <h3 className="mb-3 font-label text-[12px] font-semibold uppercase tracking-[0.1em] text-[var(--ink-3)]">Legend</h3>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            {(Object.keys(UNIT_STATUS_STYLES) as UnitStatus[]).map((status) => (
              <li key={status} className="flex items-center gap-2.5">
                <Swatch status={status} />
                <span>{UNIT_STATUS_STYLES[status].label}</span>
              </li>
            ))}
            <li className="col-span-2 flex items-center gap-2.5">
              <span aria-hidden className="h-4 w-4 shrink-0 border border-dashed border-[var(--ink)] bg-[var(--paper-2)]" />
              <span>Building: tap to see floors</span>
            </li>
          </ul>
        </div>
      </section>
    </div>
  );
}
