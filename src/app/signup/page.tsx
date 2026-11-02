// Sub-admin signup request. Accounts start status='pending' (handle_new_user
// trigger) and are unusable until an admin approves them.
"use client";

import { useState } from "react";
import Link from "next/link";
import { signUpSubAdmin } from "@/lib/actions/auth";

const inputCls =
  "w-full border-2 border-[var(--ink)] bg-white px-4 py-3 text-[15px] text-[var(--ink)] placeholder:text-[var(--ink-3)]/70 focus:outline-none focus-visible:ring-4 focus-visible:ring-[var(--signal)]";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-label text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--ink-3)]">{label}</span>
      {children}
    </label>
  );
}

export default function SignupPage() {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(formData: FormData) {
    setSubmitting(true);
    const result = await signUpSubAdmin(formData);
    setSubmitting(false);
    if (result?.error) setError(result.error);
  }

  return (
    <div className="theme-survey paper-grid flex flex-1 text-[var(--ink)]">
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <div className="border-2 border-[var(--ink)] bg-white p-7 shadow-[var(--hard)]">
        <h1 className="font-display font-bold text-[28px] leading-tight tracking-tight text-[var(--ink)]">Request access</h1>
        <p className="mb-6 mt-1 text-sm text-[var(--ink-2)]">
          For project owners and developers. An admin approves new accounts.
        </p>

        <form action={handleSubmit} className="space-y-4">
          <Field label="Name">
            <input name="name" required autoComplete="name" className={inputCls} />
          </Field>
          <Field label="Phone">
            <input name="phone" type="tel" autoComplete="tel" className={inputCls} />
          </Field>
          <Field label="Email">
            <input name="email" type="email" required autoComplete="email" className={inputCls} />
          </Field>
          <Field label="Password">
            <input name="password" type="password" required minLength={6} autoComplete="new-password" className={inputCls} />
          </Field>
          {error && (
            <p className="border-2 border-[#b3382a] bg-[#fbeeec] p-3 text-sm text-[#8f2a1f]">{error}</p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="flex min-h-12 w-full items-center justify-between bg-[var(--accent)] px-4 py-3 font-label text-[13px] font-semibold uppercase tracking-[0.08em] text-[var(--accent-ink)] transition-colors hover:bg-[var(--ink-2)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--signal)] disabled:opacity-50"
          >
            {submitting ? "Submitting…" : "Request account"}
            <span aria-hidden className="text-[var(--signal)]">→</span>
          </button>
        </form>

        <p className="mt-6 border-t-2 border-[var(--ink)] pt-5 text-center font-label text-[12px] uppercase tracking-[0.06em] text-[var(--ink-3)]">
          Already approved?{" "}
          <Link href="/login" className="font-semibold text-[var(--ink)] underline decoration-[var(--signal)] decoration-2 underline-offset-4">
            Sign in
          </Link>
        </p>
      </div>
    </main>
    </div>
  );
}
