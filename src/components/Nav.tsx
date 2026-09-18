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
    <header className="border-b border-gray-200 dark:border-gray-800">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="text-lg font-semibold">
          PlotAtlas
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/" className="hover:underline">
            Browse projects
          </Link>
          {role === "admin" && (
            <Link href="/admin" className="hover:underline">
              Admin
            </Link>
          )}
          {role === "sub_admin" && (
            <Link href="/dashboard" className="hover:underline">
              Dashboard
            </Link>
          )}
          {user ? (
            <SignOutButton />
          ) : (
            <Link href="/login" className="hover:underline">
              Sub-admin / admin login
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
