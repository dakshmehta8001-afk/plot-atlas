// Handles the redirect Supabase Auth sends the browser back to after:
//   - a viewer completes Google OAuth ("I'm interested" flow), or
//   - an admin/sub-admin clicks a magic-link-style confirmation email.
// It swaps the one-time `code` for a real session (writing the session
// cookies via the Route Handler's cookie jar), then sends the browser on to
// wherever it was trying to go (`next`), defaulting to the homepage.
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // No code, or the exchange failed — send them to login with a flag the
  // login page can use to show an "authentication failed" message.
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
