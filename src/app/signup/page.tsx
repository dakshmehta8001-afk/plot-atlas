// Sub-admin signup request. Creates an account that starts out
// status='pending' (set by the handle_new_user trigger in the schema
// migration) — it isn't usable until an admin approves it from /admin.
"use client";

import { useState } from "react";
import { signUpSubAdmin } from "@/lib/actions/auth";

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
    <main className="mx-auto w-full max-w-sm px-4 py-16">
      <h1 className="mb-2 text-2xl font-semibold">Request a sub-admin account</h1>
      <p className="mb-6 text-sm text-gray-500">
        For society/project owners and developers. An admin reviews and approves new accounts before you can
        create a project.
      </p>

      <form action={handleSubmit} className="space-y-3">
        <label className="block text-sm">
          Name
          <input
            name="name"
            required
            className="mt-1 w-full rounded-md border border-gray-300 p-2 dark:border-gray-700 dark:bg-gray-900"
          />
        </label>
        <label className="block text-sm">
          Phone
          <input
            name="phone"
            className="mt-1 w-full rounded-md border border-gray-300 p-2 dark:border-gray-700 dark:bg-gray-900"
          />
        </label>
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
            minLength={6}
            className="mt-1 w-full rounded-md border border-gray-300 p-2 dark:border-gray-700 dark:bg-gray-900"
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-60 dark:bg-white dark:text-gray-900"
        >
          {submitting ? "Submitting…" : "Request account"}
        </button>
      </form>
    </main>
  );
}
