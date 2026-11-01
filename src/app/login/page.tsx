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
    <p className="mb-5 rounded-xl border border-[#e8c3bd] bg-[#fbeeec] p-3 text-sm text-[#a2362a]">
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
    <div className="theme-paper flex flex-1 bg-[var(--paper)] text-[var(--ink)]">
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <div className="rounded-3xl border border-[var(--line)] bg-white p-8 shadow-[0_1px_2px_rgba(27,42,34,0.05),0_20px_40px_-24px_rgba(27,42,34,0.3)]">
        <h1 className="mb-1 font-display text-[28px] leading-tight tracking-tight text-[var(--ink)]">Sign in</h1>
        <p className="mb-6 text-sm text-[var(--ink-2)]">Admin and sub-admin access</p>

        <Suspense fallback={null}>
          <CallbackErrorNotice />
        </Suspense>

        <form action={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">
              Email
            </span>
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              className="w-full rounded-xl border border-[var(--line)] bg-white px-4 py-3 text-[15px] text-[var(--ink)] transition-colors placeholder:text-[var(--ink-3)]/70 focus:border-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/20"
              placeholder="you@company.com"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">
              Password
            </span>
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="w-full rounded-xl border border-[var(--line)] bg-white px-4 py-3 text-[15px] text-[var(--ink)] transition-colors placeholder:text-[var(--ink-3)]/70 focus:border-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/20"
              placeholder="••••••••"
            />
          </label>

          {error && (
            <p className="rounded-xl border border-[#e8c3bd] bg-[#fbeeec] p-3 text-sm text-[#a2362a]">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="min-h-12 w-full rounded-xl bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-[var(--accent-ink)] transition-opacity hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-6 border-t border-[var(--line)] pt-5 text-center text-sm text-[var(--ink-3)]">
          Own or manage a project?{" "}
          <Link href="/signup" className="font-medium text-[var(--accent)] underline-offset-4 hover:underline">
            Request access
          </Link>
        </p>
      </div>
    </main>
    </div>
  );
}
