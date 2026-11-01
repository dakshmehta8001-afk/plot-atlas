// One project on the public browse page: plan image, name, locality, how many
// plots are open and the starting price. Light "paper" palette (see globals.css).
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

export function ProjectCard({ project, stats, index = 0 }: { project: Project; stats?: ProjectStats; index?: number }) {
  const location = displayLocation(project.location);
  const meta = [location, project.developer_name].filter(Boolean).join(" · ");
  const hasStats = !!stats && stats.total > 0;
  return (
    <Link
      href={`/projects/${project.slug}`}
      className="group block rounded-[20px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--paper)] motion-safe:animate-[settleIn_420ms_var(--ease-cinematic)_backwards]"
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
    >
      <div className="overflow-hidden rounded-[20px] border border-[var(--line)] bg-white shadow-[0_1px_2px_rgba(27,42,34,0.05),0_12px_28px_-16px_rgba(27,42,34,0.25)] transition-shadow duration-300 group-hover:shadow-[0_2px_4px_rgba(27,42,34,0.06),0_18px_36px_-16px_rgba(27,42,34,0.32)]">
        <div className="relative aspect-[4/3] overflow-hidden bg-[var(--paper-2)]">
          {project.plan_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage thumbnail, not worth next/image optimisation
            <img
              src={project.plan_image_url}
              alt={`Layout plan of ${project.name}`}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover object-center transition-transform duration-500 motion-safe:group-hover:scale-[1.03]"
            />
          ) : (
            <div className="grid h-full w-full place-items-center text-xs text-[var(--ink-3)]">No plan yet</div>
          )}
        </div>

        <div className="px-4 pb-4 pt-3.5">
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-display text-[19px] leading-snug text-[var(--ink)]">{project.name}</h3>
            <span aria-hidden className="mt-0.5 shrink-0 text-[var(--ink-3)] transition-transform motion-safe:group-hover:translate-x-0.5">
              →
            </span>
          </div>
          {meta && <p className="mt-0.5 truncate text-[13px] text-[var(--ink-2)]">{meta}</p>}

          {hasStats && (
            <div className="mt-3.5">
              <div
                role="img"
                aria-label={SEGMENTS.filter((s) => stats[s.key] > 0)
                  .map((s) => `${stats[s.key]} ${s.label}`)
                  .join(", ")}
                className="flex h-1.5 gap-px overflow-hidden rounded-full bg-[var(--paper-2)]"
              >
                {SEGMENTS.filter((s) => stats[s.key] > 0).map((s) => (
                  <span key={s.key} style={{ width: `${(stats[s.key] / stats.total) * 100}%`, background: s.color }} />
                ))}
              </div>
              <div className="mt-2.5 flex items-baseline justify-between gap-3 text-[13px]">
                <span className="text-[var(--ink-2)]">
                  {stats.available} of {stats.total} {stats.noun} open
                </span>
                {stats.fromPrice !== null && (
                  <span className="font-semibold text-[var(--ink)]">
                    <span className="mr-1 font-normal text-[var(--ink-3)]">From</span>
                    {formatInrShort(stats.fromPrice)}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

export function ProjectCardSkeleton() {
  return (
    <div className="animate-pulse overflow-hidden rounded-[20px] border border-[var(--line)] bg-white motion-reduce:animate-none">
      <div className="aspect-[4/3] bg-[var(--paper-2)]" />
      <div className="px-4 pb-4 pt-3.5">
        <div className="h-5 w-2/3 rounded bg-[var(--paper-2)]" />
        <div className="mt-2 h-3.5 w-1/3 rounded bg-[var(--paper-2)]" />
        <div className="mt-4 h-1.5 w-full rounded-full bg-[var(--paper-2)]" />
      </div>
    </div>
  );
}
