// Email/password login for admins and sub-admins (per spec, viewers never
// use this page — they sign in with Google directly from the enquiry
// flow). A thin Client Component wraps the form so it can show the
// server action's returned error inline without a full page reload.
"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { login } from "@/lib/actions/auth";

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const searchParams = useSearchParams();
  const callbackError = searchParams.get("error");

  async function handleSubmit(formData: FormData) {
    setSubmitting(true);
    const result = await login(formData);
    setSubmitting(false);
    if (result?.error) setError(result.error);
  }

  return (
    <main className="mx-auto w-full max-w-sm px-4 py-16">
      <h1 className="mb-6 text-2xl font-semibold">Sub-admin / admin login</h1>

      {callbackError && (
        <p className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          Sign-in failed. Please try again.
        </p>
      )}

      <form action={handleSubmit} className="space-y-3">
        <label className="block text-sm">
          Email
          <input
            name="email"
            type="email"
            required
            className="mt-1 w-full rounded-md border border-gray-300 p-2 dark:border-gray-700 dark:bg-gray-900"
          />
        </label>
        <label className="block text-sm">
          Password
          <input
            name="password"
            type="password"
            required
            className="mt-1 w-full rounded-md border border-gray-300 p-2 dark:border-gray-700 dark:bg-gray-900"
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-60 dark:bg-white dark:text-gray-900"
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="mt-4 text-sm text-gray-500">
        Own or manage a project?{" "}
        <Link href="/signup" className="underline">
          Request a sub-admin account
        </Link>
        .
      </p>
    </main>
  );
}
