"use client";

// One-click draft/published toggle shown on a project's dashboard page. A
// project only appears on the public homepage / /projects/[slug] once
// published (see the RLS policy in the schema migration), so a sub-admin
// can finish tracing plots/buildings/flats privately before going live.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { setProjectStatus } from "@/lib/actions/projects";
import type { ProjectStatus } from "@/lib/types";

export function PublishToggle({ projectId, status }: { projectId: string; status: ProjectStatus }) {
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function toggle() {
    setPending(true);
    await setProjectStatus(projectId, status === "published" ? "draft" : "published");
    setPending(false);
    router.refresh();
  }

  return (
    <button
      onClick={toggle}
      disabled={pending}
      className={
        status === "published"
          ? "rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:hover:bg-gray-800"
          : "rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-60"
      }
    >
      {pending ? "Saving…" : status === "published" ? "Unpublish" : "Publish"}
    </button>
  );
}
