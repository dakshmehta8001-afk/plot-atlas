// Browser-side Supabase client. Use this from Client Components ("use client"
// files) — e.g. the polygon tracer's live drag interactions, the building
// drill-down animation's local zoom state, or the "I'm interested" button's
// optimistic UI. It stores the session in browser cookies (via @supabase/ssr)
// so the server can read the same session back on the next request.
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
