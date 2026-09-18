// "About" tab content for a project's public page: developer/location
// details plus a short legend explaining the sold/hold/available colors and
// the dashed-outline building markers, so a first-time viewer understands
// the map without guessing.
import type { Project } from "@/lib/types";
import { UNIT_STATUS_STYLES } from "@/lib/types";

export function AboutPanel({ project }: { project: Project }) {
  return (
    <div className="max-h-80 w-80 space-y-4 overflow-y-auto rounded-xl border border-white/10 bg-[#0f2436]/95 p-4 text-white shadow-2xl backdrop-blur">
      <div>
        <h3 className="font-semibold">{project.name}</h3>
        {project.location && <p className="text-sm text-white/60">{project.location}</p>}
        {project.developer_name && <p className="mt-1 text-xs uppercase tracking-wide text-white/40">{project.developer_name}</p>}
      </div>
      {project.description && <p className="text-sm text-white/70">{project.description}</p>}
      <div>
        <p className="mb-2 text-xs uppercase tracking-wide text-white/40">Legend</p>
        <div className="space-y-1.5 text-sm">
          {Object.values(UNIT_STATUS_STYLES).map((style) => (
            <div key={style.label} className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-sm border" style={{ backgroundColor: style.fill, borderColor: style.border }} />
              <span>{style.label}</span>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-sm border border-dashed" style={{ backgroundColor: "rgba(99,102,241,0.35)", borderColor: "#6366f1" }} />
            <span>Building (click to see floors)</span>
          </div>
        </div>
      </div>
    </div>
  );
}
