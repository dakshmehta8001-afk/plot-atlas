// Create-project form: name/location/developer/description plus the master
// site-plan image upload. A plain <form action={createProject}> Server
// Action — it needs to carry a File, and Server Actions handle multipart
// FormData (including files) natively, so no separate upload endpoint is
// needed. Unlike the reference product this is based on, there's no
// "plots vs flats" project-type choice here: a single project can contain
// both standalone plots and buildings full of flats, chosen per-shape while
// tracing (see ProjectTracerClient).
"use client";

import { useState } from "react";
import { createProject } from "@/lib/actions/projects";

export default function NewProjectPage() {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(formData: FormData) {
    setSubmitting(true);
    const result = await createProject(formData);
    setSubmitting(false);
    if (result?.error) setError(result.error);
  }

  return (
    <div className="mx-auto w-full max-w-lg">
      <h1 className="mb-6 text-2xl font-semibold">New project</h1>
      <form action={handleSubmit} className="space-y-3">
        <label className="block text-sm">
          Project name
          <input
            name="name"
            required
            className="mt-1 w-full rounded-md border border-gray-300 p-2 dark:border-gray-700 dark:bg-gray-900"
          />
        </label>
        <label className="block text-sm">
          Developer name
          <input
            name="developer_name"
            className="mt-1 w-full rounded-md border border-gray-300 p-2 dark:border-gray-700 dark:bg-gray-900"
          />
        </label>
        <label className="block text-sm">
          Location
          <input
            name="location"
            className="mt-1 w-full rounded-md border border-gray-300 p-2 dark:border-gray-700 dark:bg-gray-900"
          />
        </label>
        <label className="block text-sm">
          Description
          <textarea
            name="description"
            rows={3}
            className="mt-1 w-full rounded-md border border-gray-300 p-2 dark:border-gray-700 dark:bg-gray-900"
          />
        </label>
        <label className="block text-sm">
          Master site-plan image (image or PDF)
          <input name="plan_image" type="file" accept="image/*,application/pdf" className="mt-1 w-full text-sm" />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-60 dark:bg-white dark:text-gray-900"
        >
          {submitting ? "Creating…" : "Create project"}
        </button>
      </form>
    </div>
  );
}
