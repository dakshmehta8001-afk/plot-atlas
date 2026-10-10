"use client";

// Editable project details (name/location/developer/description) plus the
// developer's public contact info — the phone/WhatsApp/email that render as
// quick-contact icons on a unit's info card. No dedicated edit screen
// existed for a project's basic fields before this; a sub-admin previously
// could only set them at creation time.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateProject } from "@/lib/actions/projects";
import type { Project } from "@/lib/types";

export function ProjectDetailsForm({ project }: { project: Project }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(formData: FormData) {
    setSaving(true);
    setError(null);
    const result = await updateProject(project.id, formData);
    setSaving(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
      >
        Edit details &amp; contact info
      </button>
    );
  }

  return (
    <form action={handleSubmit} className="space-y-3 rounded-lg border border-gray-200 p-4 dark:border-gray-800">
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">
          Project name
          <input
            name="name"
            defaultValue={project.name}
            required
            className="mt-1 w-full rounded-md border border-gray-300 p-2 dark:border-gray-700 dark:bg-gray-900"
          />
        </label>
        <label className="block text-sm">
          Developer name
          <input
            name="developer_name"
            defaultValue={project.developer_name ?? ""}
            className="mt-1 w-full rounded-md border border-gray-300 p-2 dark:border-gray-700 dark:bg-gray-900"
          />
        </label>
      </div>
      <label className="block text-sm">
        Location
        <input
          name="location"
          defaultValue={project.location ?? ""}
          className="mt-1 w-full rounded-md border border-gray-300 p-2 dark:border-gray-700 dark:bg-gray-900"
        />
      </label>
      <label className="block text-sm">
        Description
        <textarea
          name="description"
          defaultValue={project.description ?? ""}
          rows={2}
          className="mt-1 w-full rounded-md border border-gray-300 p-2 dark:border-gray-700 dark:bg-gray-900"
        />
      </label>

      <p className="pt-1 text-xs font-medium uppercase tracking-wide text-gray-400">
        Public contact info (shown as quick-contact icons on plot/flat popups — leave blank to omit)
      </p>
      <div className="grid grid-cols-3 gap-3">
        <label className="block text-sm">
          Phone
          <input
            name="contact_phone"
            type="tel"
            defaultValue={project.contact_phone ?? ""}
            placeholder="+91XXXXXXXXXX"
            className="mt-1 w-full rounded-md border border-gray-300 p-2 dark:border-gray-700 dark:bg-gray-900"
          />
        </label>
        <label className="block text-sm">
          WhatsApp
          <input
            name="contact_whatsapp"
            type="tel"
            defaultValue={project.contact_whatsapp ?? ""}
            placeholder="+91XXXXXXXXXX"
            className="mt-1 w-full rounded-md border border-gray-300 p-2 dark:border-gray-700 dark:bg-gray-900"
          />
        </label>
        <label className="block text-sm">
          Email
          <input
            name="contact_email"
            type="email"
            defaultValue={project.contact_email ?? ""}
            className="mt-1 w-full rounded-md border border-gray-300 p-2 dark:border-gray-700 dark:bg-gray-900"
          />
        </label>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-gray-500 hover:underline">
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-60 dark:bg-white dark:text-gray-900"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
