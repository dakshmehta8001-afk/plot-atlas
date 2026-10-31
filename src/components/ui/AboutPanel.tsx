// "About" tab content for a project's public page: developer/location
// details plus a legend explaining status colours and building markers.
// A location saved as a Maps link becomes a "Open in Maps" button rather
// than being printed as a raw URL.
import type { Project } from "@/lib/types";
import { UNIT_STATUS_STYLES } from "@/lib/types";

export function AboutPanel({ project }: { project: Project }) {
  const loc = project.location?.trim() ?? "";
  const locIsUrl = /^https?:\/\//i.test(loc);

  return (
    <div className="flex h-full w-full items-start justify-center overflow-y-auto px-4 pb-28 pt-6 sm:items-center">
      <div className="w-full max-w-md space-y-6 rounded-3xl border border-white/10 bg-[#0b1220]/90 p-6 text-white shadow-2xl backdrop-blur-xl">
        <div>
          {project.developer_name && (
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-blue-300/70">{project.developer_name}</p>
          )}
          <h2 className="text-2xl font-bold tracking-tight">{project.name}</h2>
          {loc && !locIsUrl && <p className="mt-1 text-sm text-white/55">{loc}</p>}
          {locIsUrl && (
            <a
              href={loc}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-medium text-white/85 transition-colors hover:bg-white/10"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                <path d="M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11z" />
                <circle cx="12" cy="10" r="2.5" />
              </svg>
              Open in Maps
            </a>
          )}
        </div>

        {project.description && <p className="text-sm leading-relaxed text-white/70">{project.description}</p>}

        <div>
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-white/40">Legend</p>
          <div className="grid grid-cols-2 gap-2.5 text-sm">
            {Object.values(UNIT_STATUS_STYLES).map((style) => (
              <div key={style.label} className="flex items-center gap-2.5">
                <span className="h-3.5 w-3.5 rounded border" style={{ backgroundColor: style.fill, borderColor: style.border }} />
                <span className="text-white/80">{style.label}</span>
              </div>
            ))}
            <div className="col-span-2 flex items-center gap-2.5">
              <span className="h-3.5 w-3.5 rounded border border-dashed" style={{ backgroundColor: "rgba(99,102,241,0.35)", borderColor: "#6366f1" }} />
              <span className="text-white/80">Building — tap to see floors</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
