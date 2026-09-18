// Server-side Supabase client. Use this from Server Components, Server
// Actions, and Route Handlers. It reads/writes the auth session through the
// Next.js `cookies()` API so Postgres RLS policies see the signed-in user's
// real identity (auth.uid()) rather than an anonymous session.
//
// `cookies()` is async in Next.js 15+, so this factory is async too — every
// caller must `await createClient()`.
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            // Server Components can't set cookies (there's no response to
            // attach them to) — this throws there, which is harmless as long
            // as src/proxy.ts refreshes the session on every request. Only
            // Server Actions and Route Handlers actually need this to work.
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Ignored — see comment above.
          }
        },
      },
    },
  );
}
