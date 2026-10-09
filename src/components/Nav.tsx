// Top navigation bar. A server component so it can read the current session
// once per request and show role-appropriate links (a viewer never sees
// "Admin", a sub-admin never sees "Manage sub-admins", etc.) without a
// client-side flash of the wrong nav before the session loads.
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/AuthButtons";

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
    <header className="sticky top-0 z-[1000] border-b border-white/10 bg-[#030712]/70 backdrop-blur-xl shadow-2xl">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="text-xl font-bold tracking-tight text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.4)] transition-transform hover:scale-105 active:scale-95">
          PlotAtlas
        </Link>
        <div className="flex items-center gap-6 text-sm font-medium">
          <Link href="/" className="text-white/80 transition-all hover:text-white hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.5)]">
            Browse projects
          </Link>
          {role === "admin" && (
            <Link href="/admin" className="text-white/80 transition-all hover:text-white hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.5)]">
              Admin
            </Link>
          )}
          {role === "sub_admin" && (
            <Link href="/dashboard" className="text-white/80 transition-all hover:text-white hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.5)]">
              Dashboard
            </Link>
          )}
          {user ? (
            <SignOutButton className="text-white/80 transition-all hover:text-white hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.5)]" />
          ) : (
            <Link href="/login" className="rounded-full bg-white/10 px-5 py-2 text-white transition-all hover:bg-white/20 hover:scale-105 active:scale-95 border border-white/5 shadow-inner">
              Login
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
