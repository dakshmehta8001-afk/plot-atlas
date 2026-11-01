"use client";

// Client wrapper for the top bar: it only needs the current path, so the rest
// of Nav (session and role lookups) can stay a server component. The Projects
// page uses the light palette; maps, dashboards and auth screens stay dark.
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function NavShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const theme = pathname === "/" ? "light" : "dark";
  return (
    <header
      data-theme={theme}
      className="sticky top-0 z-[1000] border-b border-[var(--nav-border)] bg-[var(--nav-bg)] backdrop-blur-xl"
    >
      {children}
    </header>
  );
}

// The sign-in and request-access pages already are the sign-in screen, so a
// second "Sign in" button in the bar is just noise there.
export function SignInLink({ className }: { className: string }) {
  const pathname = usePathname();
  if (pathname.startsWith("/login") || pathname.startsWith("/signup")) return null;
  return (
    <Link href="/login" className={className}>
      Sign in
    </Link>
  );
}
