// Sub-admin signup request. Accounts start status='pending' (handle_new_user
// trigger) and are unusable until an admin approves them.
"use client";

import { useState } from "react";
import Link from "next/link";
import { signUpSubAdmin } from "@/lib/actions/auth";

const inputCls =
  "w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white shadow-inner transition-colors placeholder:text-white/25 focus:border-white/30 focus:outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-white/40">{label}</span>
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
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <div className="rounded-3xl border border-white/10 bg-[var(--map-panel)] p-8 shadow-[0_8px_40px_rgba(0,0,0,0.4)]">
        <h1 className="text-2xl font-bold tracking-tight text-white">Request access</h1>
        <p className="mb-6 mt-1 text-sm text-white/50">
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
            <p className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-white px-4 py-3 text-sm font-bold text-[#030712] transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
          >
            {submitting ? "Submitting…" : "Request account"}
          </button>
        </form>

        <p className="mt-6 border-t border-white/10 pt-5 text-center text-sm text-white/40">
          Already approved?{" "}
          <Link href="/login" className="font-medium text-white/70 underline-offset-4 hover:text-white hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
