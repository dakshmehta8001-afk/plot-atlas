"use server";

// Server Actions for the project gallery (Media panel/tab): recording an
// uploaded image/video and removing one, used by the dashboard's MediaManager.
// The browser uploads files directly to Supabase Storage and sends only the
// storage path here — file bytes never reach this server action.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getValidatedPublicUrl } from "@/lib/storage/serverPaths";
import type { ActionResult } from "./auth";

export async function uploadProjectMedia(
  projectId: string,
  { path, mediaType }: { path: string; mediaType: string },
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  // Only the two values MediaManager actually sends; anything else is a
  // malformed or forged call.
  if (mediaType !== "image" && mediaType !== "video") {
    return { error: "Invalid media type." };
  }

  const validated = getValidatedPublicUrl(supabase, "project-media", path, user.id);
  if ("error" in validated) return { error: validated.error };

  const { error } = await supabase.from("project_media").insert({
    project_id: projectId,
    media_url: validated.url,
    media_type: mediaType,
  });
  if (error) return { error: error.message };

  revalidatePath(`/dashboard/projects/${projectId}`);
  revalidatePath("/projects", "layout");
  return {};
}

export async function deleteProjectMedia(mediaId: string, projectId: string): Promise<ActionResult> {
  const supabase = await createClient();

  const { error } = await supabase.from("project_media").delete().eq("id", mediaId);
  if (error) return { error: error.message };

  revalidatePath(`/dashboard/projects/${projectId}`);
  revalidatePath("/projects", "layout");
  return {};
}
