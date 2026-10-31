// Email/password login for admins and sub-admins (per spec, viewers never
// use this page — they sign in with Google directly from the enquiry
// flow). useSearchParams() lives in a Suspense-wrapped child: Next.js
// requires that boundary or the page can't be statically prerendered.
"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { login } from "@/lib/actions/auth";

function CallbackErrorNotice() {
  const searchParams = useSearchParams();
  if (!searchParams.get("error")) return null;
  return (
    <p className="mb-5 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
      Sign-in failed. Please try again.
    </p>
  );
}

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(formData: FormData) {
    setSubmitting(true);
    const result = await login(formData);
    setSubmitting(false);
    if (result?.error) setError(result.error);
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <div className="rounded-3xl border border-white/10 bg-[var(--map-panel)] p-8 shadow-[0_8px_40px_rgba(0,0,0,0.4)] backdrop-blur-xl">
        <h1 className="mb-1 text-2xl font-bold tracking-tight text-white">Sign in</h1>
        <p className="mb-6 text-sm text-white/50">Admin and sub-admin access</p>

        <Suspense fallback={null}>
          <CallbackErrorNotice />
        </Suspense>

        <form action={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-white/40">
              Email
            </span>
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white shadow-inner transition-colors placeholder:text-white/25 focus:border-white/30 focus:outline-none"
              placeholder="you@company.com"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-white/40">
              Password
            </span>
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white shadow-inner transition-colors placeholder:text-white/25 focus:border-white/30 focus:outline-none"
              placeholder="••••••••"
            />
          </label>

          {error && (
            <p className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-white px-4 py-3 text-sm font-bold text-[#030712] shadow-[0_0_20px_rgba(255,255,255,0.15)] transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:hover:scale-100"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-6 border-t border-white/10 pt-5 text-center text-sm text-white/40">
          Own or manage a project?{" "}
          <Link href="/signup" className="font-medium text-white/70 underline-offset-4 transition-colors hover:text-white hover:underline">
            Request access
          </Link>
        </p>
      </div>
    </main>
  );
}
