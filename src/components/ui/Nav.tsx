// Top navigation bar. Server component: reads the session once per request so
// role-specific links render without a client-side flash.
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/ui/AuthButtons";
import { NavShell, SignInLink } from "@/components/ui/NavShell";

const linkCls =
  "inline-flex min-h-11 items-center rounded-full px-3 text-[13px] font-medium text-[var(--nav-fg-muted)] transition-colors hover:bg-[var(--nav-hover)] hover:text-[var(--nav-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nav-ring)]";

export async function Nav() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let role: string | null = null;
  if (user) {
    const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).single();
    role = profile?.role ?? null;
  }

  return (
    <NavShell>
      <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link
          href="/"
          className="flex min-h-11 items-center gap-2 rounded-full pr-2 font-display text-[17px] tracking-tight text-[var(--nav-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nav-ring)]"
        >
          <span aria-hidden className="grid h-6 w-6 place-items-center rounded-md bg-[var(--nav-mark-bg)] font-sans text-[11px] font-bold text-[var(--nav-mark-fg)]">
            P
          </span>
          PlotAtlas
        </Link>
        <div className="flex items-center gap-1">
          <Link href="/" className={`${linkCls} hidden sm:inline-flex`}>
            Projects
          </Link>
          {role === "admin" && (
            <Link href="/admin" className={linkCls}>
              Admin
            </Link>
          )}
          {role === "sub_admin" && (
            <Link href="/dashboard" className={linkCls}>
              Dashboard
            </Link>
          )}
          {user ? (
            <SignOutButton className={linkCls} />
          ) : (
            <SignInLink className="ml-1 inline-flex min-h-9 items-center rounded-full bg-[var(--nav-btn-bg)] px-4 text-[13px] font-semibold text-[var(--nav-btn-fg)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nav-ring)]" />
          )}
        </div>
      </nav>
    </NavShell>
  );
}
