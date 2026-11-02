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
    <p className="mb-5 border-2 border-[#b3382a] bg-[#fbeeec] p-3 text-sm text-[#8f2a1f]">
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
    <div className="theme-survey paper-grid flex flex-1 text-[var(--ink)]">
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <div className="border-2 border-[var(--ink)] bg-white p-7 shadow-[var(--hard)]">
        <h1 className="mb-1 font-display font-bold text-[28px] leading-tight tracking-tight text-[var(--ink)]">Sign in</h1>
        <p className="mb-6 font-label text-[12px] uppercase tracking-[0.06em] text-[var(--ink-2)]">Admin and sub-admin access</p>

        <Suspense fallback={null}>
          <CallbackErrorNotice />
        </Suspense>

        <form action={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block font-label text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--ink-3)]">
              Email
            </span>
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              className="w-full border-2 border-[var(--ink)] bg-white px-4 py-3 text-[15px] text-[var(--ink)] placeholder:text-[var(--ink-3)]/70 focus:outline-none focus-visible:ring-4 focus-visible:ring-[var(--signal)]"
              placeholder="you@company.com"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block font-label text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--ink-3)]">
              Password
            </span>
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="w-full border-2 border-[var(--ink)] bg-white px-4 py-3 text-[15px] text-[var(--ink)] placeholder:text-[var(--ink-3)]/70 focus:outline-none focus-visible:ring-4 focus-visible:ring-[var(--signal)]"
              placeholder="••••••••"
            />
          </label>

          {error && (
            <p className="border-2 border-[#b3382a] bg-[#fbeeec] p-3 text-sm text-[#8f2a1f]">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="flex min-h-12 w-full items-center justify-between bg-[var(--accent)] px-4 py-3 font-label text-[13px] font-semibold uppercase tracking-[0.08em] text-[var(--accent-ink)] transition-colors hover:bg-[var(--ink-2)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--signal)] disabled:opacity-50"
          >
            {submitting ? "Signing in…" : "Sign in"}
            <span aria-hidden className="text-[var(--signal)]">→</span>
          </button>
        </form>

        <p className="mt-6 border-t-2 border-[var(--ink)] pt-5 text-center font-label text-[12px] uppercase tracking-[0.06em] text-[var(--ink-3)]">
          Own or manage a project?{" "}
          <Link href="/signup" className="font-semibold text-[var(--ink)] underline decoration-[var(--signal)] decoration-2 underline-offset-4">
            Request access
          </Link>
        </p>
      </div>
    </main>
    </div>
  );
}
