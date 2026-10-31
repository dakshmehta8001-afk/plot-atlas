"use client";

// Segmented section nav for /admin; highlights the current section.
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/sub-admins", label: "Sub-admins" },
  { href: "/admin/projects", label: "Projects" },
  { href: "/admin/leads", label: "Leads" },
];

export function AdminTabs() {
  const pathname = usePathname();
  return (
    <nav className="mb-8 flex gap-1 overflow-x-auto rounded-xl border border-white/10 bg-white/[0.03] p-1 [scrollbar-width:none] sm:inline-flex">
      {TABS.map((t) => {
        const active = t.href === "/admin" ? pathname === "/admin" : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              active ? "bg-white text-[#030712]" : "text-white/60 hover:bg-white/5 hover:text-white"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
