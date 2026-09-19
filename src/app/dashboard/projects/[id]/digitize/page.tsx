// Entry point for the auto-digitize feature — a Server Component shell only
// (the actual OpenCV.js/Tesseract.js workspace is 100% client-side, loaded
// via DigitizeWorkspaceLoader). This page's only job is the RLS-backed
// project fetch and ownership check, same pattern as
// buildings/[buildingId]/page.tsx: a non-owner/non-admin gets `notFound()`
// because RLS silently returns no row, not a special check here.
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DigitizeWorkspaceLoader } from "@/components/digitize/DigitizeWorkspaceLoader";

export default async function DigitizePage(props: PageProps<"/dashboard/projects/[id]/digitize">) {
  const { id } = await props.params;
  const supabase = await createClient();

  const { data: project } = await supabase.from("projects").select("id, name, plan_image_url").eq("id", id).single();
  if (!project) notFound();

  return (
    <div className="flex h-[calc(100vh-140px)] min-h-[640px] flex-col">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Auto-digitize: {project.name}</h1>
          <p className="text-sm text-gray-500">Automatic detection + manual correction — review everything before saving.</p>
        </div>
        <Link href={`/dashboard/projects/${id}`} className="text-sm underline">
          ← Back to project
        </Link>
      </div>
      <div className="flex-1 overflow-hidden">
        <DigitizeWorkspaceLoader projectId={id} projectName={project.name} hasExistingPlanImage={!!project.plan_image_url} />
      </div>
    </div>
  );
}
