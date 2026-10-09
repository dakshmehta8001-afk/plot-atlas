"use client";

// Client-side auth buttons. Google sign-in has to happen in the browser
// (supabase-js redirects the whole page to Google, then Google redirects
// back to /auth/callback) rather than via a Server Action, which can't
// perform a full-page external redirect the same way.
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { signOut } from "@/lib/actions/auth";

export function GoogleSignInButton({
  next = "/",
  className = "",
  label = "Continue with Google",
}: {
  next?: string;
  className?: string;
  label?: string;
}) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    // Browser navigates away to Google here; no need to reset `loading`.
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className={`inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-white shadow-inner transition-all hover:bg-white/10 hover:scale-105 active:scale-95 disabled:opacity-60 ${className}`}
    >
      {loading ? "Redirecting…" : label}
    </button>
  );
}

export function SignOutButton({ className = "" }: { className?: string }) {
  return (
    <form action={signOut}>
      <button
        type="submit"
        className={`text-sm font-medium ${className}`}
      >
        Sign out
      </button>
    </form>
  );
}
