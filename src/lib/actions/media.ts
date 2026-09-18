"use server";

// Server Actions for the project gallery (Media panel/tab): uploading an
// image/video and removing one, used by the dashboard's MediaManager.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./auth";

export async function uploadProjectMedia(projectId: string, file: File): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  const path = `${user.id}/${Date.now()}-${file.name}`;
  const { error: uploadError } = await supabase.storage
    .from("project-media")
    .upload(path, file, { contentType: file.type });
  if (uploadError) return { error: uploadError.message };

  const { data: publicUrl } = supabase.storage.from("project-media").getPublicUrl(path);
  const mediaType = file.type.startsWith("video/") ? "video" : "image";

  const { error } = await supabase.from("project_media").insert({
    project_id: projectId,
    media_url: publicUrl.publicUrl,
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
