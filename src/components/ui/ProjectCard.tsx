// One project on the public browse page, laid out like the title block on a
// survey drawing: the plan on top, then fixed rows of facts. Square edges,
// navy ink, one orange tag for what is open. See .theme-survey in globals.css.
import Link from "next/link";
import { formatInrShort } from "@/lib/format";
import type { Project } from "@/lib/types";

// The location field is free text and sometimes holds a pasted Maps link.
export function displayLocation(location: string | null): string | null {
  if (!location) return null;
  const v = location.trim();
  return /^https?:\/\//i.test(v) ? null : v;
}

export interface ProjectStats {
  total: number;
  available: number;
  hold: number;
  booked: number;
  sold: number;
  /** Lowest total price among priced, still-available units. */
  fromPrice: number | null;
  /** "plots", "flats" or "units", depending on what the project contains. */
  noun: string;
}

const SEGMENTS = [
  { key: "available", color: "var(--st-available)", label: "open" },
  { key: "hold", color: "var(--st-hold)", label: "on hold" },
  { key: "booked", color: "var(--st-booked)", label: "booked" },
  { key: "sold", color: "var(--st-sold)", label: "sold" },
] as const;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-[var(--line)] px-3 py-2 first:border-t-0">
      <dt className="font-label text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--ink-3)]">{label}</dt>
      <dd className="min-w-0 truncate text-right font-label text-[12px] font-medium text-[var(--ink)]">{children}</dd>
    </div>
  );
}

export function ProjectCard({ project, stats, index = 0 }: { project: Project; stats?: ProjectStats; index?: number }) {
  const location = displayLocation(project.location);
  const hasStats = !!stats && stats.total > 0;
  return (
    <Link
      href={`/projects/${project.slug}`}
      className="group block focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--signal)] motion-safe:animate-[settleIn_420ms_var(--ease-cinematic)_backwards]"
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
    >
      <div className="border-2 border-[var(--ink)] bg-white shadow-[var(--hard)] transition-transform duration-150 group-hover:-translate-x-0.5 group-hover:-translate-y-0.5 group-active:translate-x-0.5 group-active:translate-y-0.5">
        <div className="relative aspect-[4/3] overflow-hidden border-b-2 border-[var(--ink)] bg-white">
          {project.plan_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage thumbnail, not worth next/image optimisation
            <img
              src={project.plan_image_url}
              alt={`Layout plan of ${project.name}`}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover object-center"
            />
          ) : (
            <div className="grid h-full w-full place-items-center font-label text-xs uppercase tracking-wider text-[var(--ink-3)]">No plan yet</div>
          )}
          {hasStats && stats.available > 0 && (
            <span className="absolute right-0 top-0 bg-[var(--signal)] px-2.5 py-1 font-label text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--signal-ink)]">
              {stats.available} open
            </span>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-b-2 border-[var(--ink)] px-3 py-2.5">
          <h3 className="truncate font-display text-[18px] font-bold leading-tight tracking-tight text-[var(--ink)]">{project.name}</h3>
          <span aria-hidden className="shrink-0 font-label text-[var(--signal)] transition-transform group-hover:translate-x-0.5">
            →
          </span>
        </div>

        <dl>
          {location && <Row label="Location">{location}</Row>}
          {project.developer_name && <Row label="Developer">{project.developer_name}</Row>}
          {hasStats && (
            <Row label={stats.noun}>
              {stats.total} · {stats.available} open
            </Row>
          )}
          {hasStats && stats.fromPrice !== null && <Row label="From">{formatInrShort(stats.fromPrice)}</Row>}
        </dl>

        {hasStats && (
          <div
            role="img"
            aria-label={SEGMENTS.filter((s) => stats[s.key] > 0)
              .map((s) => `${stats[s.key]} ${s.label}`)
              .join(", ")}
            className="flex h-2 border-t-2 border-[var(--ink)]"
          >
            {SEGMENTS.filter((s) => stats[s.key] > 0).map((s) => (
              <span key={s.key} style={{ width: `${(stats[s.key] / stats.total) * 100}%`, background: s.color }} />
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}

export function ProjectCardSkeleton() {
  return (
    <div className="animate-pulse border-2 border-[var(--line)] bg-white motion-reduce:animate-none">
      <div className="aspect-[4/3] bg-[var(--paper-2)]" />
      <div className="border-t-2 border-[var(--line)] px-3 py-3">
        <div className="h-5 w-2/3 bg-[var(--paper-2)]" />
      </div>
      <div className="space-y-2 border-t border-[var(--line)] px-3 py-3">
        <div className="h-3 w-full bg-[var(--paper-2)]" />
        <div className="h-3 w-5/6 bg-[var(--paper-2)]" />
      </div>
    </div>
  );
}
