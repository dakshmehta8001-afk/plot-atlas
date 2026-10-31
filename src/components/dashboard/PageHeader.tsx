// Shared header for every dashboard/admin page: breadcrumb trail, a back
// link to the parent page, title, optional subtitle and right-side actions.
import Link from "next/link";
import type { ReactNode } from "react";

export type Crumb = { label: string; href?: string };

export function PageHeader({
  crumbs = [],
  title,
  subtitle,
  actions,
}: {
  crumbs?: Crumb[];
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  const parent = [...crumbs].reverse().find((c) => c.href);
  return (
    <header className="mb-8">
      {crumbs.length > 0 && (
        <div className="mb-4 flex items-center gap-3 text-xs">
          {parent?.href && (
            <Link
              href={parent.href}
              className="flex shrink-0 items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            >
              <span aria-hidden>←</span> Back
            </Link>
          )}
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 overflow-x-auto text-white/40 [scrollbar-width:none]">
            {crumbs.map((c, i) => (
              <span key={i} className="flex shrink-0 items-center gap-1.5">
                {i > 0 && <span className="text-white/20">/</span>}
                {c.href ? (
                  <Link href={c.href} className="transition-colors hover:text-white">
                    {c.label}
                  </Link>
                ) : (
                  <span className="text-white/70">{c.label}</span>
                )}
              </span>
            ))}
          </nav>
        </div>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold tracking-tight text-white sm:text-3xl">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-white/50">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function Section({ title, children, description }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <div className="mb-3">
        <h2 className="text-base font-semibold text-white">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-white/40">{description}</p>}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.02] px-6 py-14 text-center">
      <p className="font-medium text-white/80">{title}</p>
      {body && <p className="mx-auto mt-1.5 max-w-sm text-sm text-white/40">{body}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export const btnPrimary =
  "inline-flex items-center justify-center gap-1.5 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-[#030712] shadow-[0_0_20px_rgba(255,255,255,0.12)] transition-all hover:bg-white/90 active:scale-95 disabled:opacity-50";
export const btnSecondary =
  "inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50";
export const card = "rounded-2xl border border-white/10 bg-[var(--map-panel)] shadow-[0_4px_24px_rgba(0,0,0,0.25)]";
