// Sub-admin signup request. Accounts start status='pending' (handle_new_user
// trigger) and are unusable until an admin approves them.
"use client";

import { useState } from "react";
import Link from "next/link";
import { signUpSubAdmin } from "@/lib/actions/auth";

const inputCls =
  "w-full rounded-xl border border-[var(--line)] bg-white px-4 py-3 text-[15px] text-[var(--ink)] transition-colors placeholder:text-[var(--ink-3)]/70 focus:border-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/20";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">{label}</span>
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
    <div className="theme-paper flex flex-1 bg-[var(--paper)] text-[var(--ink)]">
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <div className="rounded-3xl border border-[var(--line)] bg-white p-8 shadow-[0_1px_2px_rgba(27,42,34,0.05),0_20px_40px_-24px_rgba(27,42,34,0.3)]">
        <h1 className="font-display text-[28px] leading-tight tracking-tight text-[var(--ink)]">Request access</h1>
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
            <p className="rounded-xl border border-[#e8c3bd] bg-[#fbeeec] p-3 text-sm text-[#a2362a]">{error}</p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="min-h-12 w-full rounded-xl bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-[var(--accent-ink)] transition-opacity hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
          >
            {submitting ? "Submitting…" : "Request account"}
          </button>
        </form>

        <p className="mt-6 border-t border-[var(--line)] pt-5 text-center text-sm text-[var(--ink-3)]">
          Already approved?{" "}
          <Link href="/login" className="font-medium text-[var(--accent)] underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
    </div>
  );
}
