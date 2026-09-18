// Session-refresh helper called from src/proxy.ts on every request. Supabase
// access tokens are short-lived; this reads the refresh token from cookies,
// asks Supabase for a fresh access token if needed, and writes any updated
// cookies onto both the incoming request (so Server Components downstream in
// this same request see the refreshed session) and the outgoing response (so
// the browser stores the refreshed cookies for the next request).
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: this call must not be removed. It revalidates the session
  // with the Supabase auth server and refreshes cookies as a side effect —
  // without it, sessions silently expire after the access token's lifetime.
  await supabase.auth.getUser();

  return response;
}
