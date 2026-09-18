// Next.js 16 renamed "middleware" to "proxy" (same mechanism: runs before a
// route renders). This is the one place route protection is enforced at the
// request level — it keeps Supabase session cookies fresh on every request,
// then bounces the wrong kind of visitor away from the two gated dashboards.
// Per-row access is still enforced by Postgres RLS (see supabase/migrations)
// regardless; this is just a UX shortcut so a wrong-role user lands on
// /login instead of an empty or broken dashboard.
import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { createClient } from "@/lib/supabase/server";

export async function proxy(request: NextRequest) {
  const response = await updateSession(request);

  const path = request.nextUrl.pathname;
  const isGatedRoute = path.startsWith("/dashboard") || path.startsWith("/admin");
  if (!isGatedRoute) return response;

  // Re-read the (now-refreshed) session to check role. This duplicates the
  // getUser() call inside updateSession, but that one only has access to
  // the request/response cookie jars, not our public.users profile table.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (path.startsWith("/admin") && profile?.role !== "admin") {
    return NextResponse.redirect(new URL("/", request.url));
  }
  if (path.startsWith("/dashboard") && profile?.role !== "sub_admin") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Run on every route except static assets and image optimization
     * files — Proxy runs on every request otherwise, which would needlessly
     * refresh cookies for CSS/JS/image requests.
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
