// Top navigation bar. Server component: reads the session once per request so
// role-specific links render without a client-side flash.
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/ui/AuthButtons";

const linkCls =
  "inline-flex min-h-11 items-center rounded-full px-3 text-[13px] font-medium text-white/70 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40";

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
    <header className="sticky top-0 z-[1000] border-b border-white/[0.06] bg-[#030712]/80 backdrop-blur-xl">
      <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link
          href="/"
          className="flex min-h-11 items-center gap-2 rounded-full pr-2 text-[15px] font-semibold tracking-tight text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
        >
          <span aria-hidden className="grid h-6 w-6 place-items-center rounded-md bg-white text-[11px] font-bold text-[#030712]">
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
            <Link
              href="/login"
              className="ml-1 inline-flex min-h-9 items-center rounded-full bg-white px-4 text-[13px] font-semibold text-[#030712] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            >
              Sign in
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
