// Shared upload helper for the three places a plan image gets uploaded
// (project creation, replacing a project's plan image, adding a floor's
// plan image) — keeps the "if it's a PDF, rasterize it first" logic in one
// place rather than duplicated three times. `supabase` is typed loosely
// (not the generated Database type) since none of the three callers share
// a more specific type either.
import type { SupabaseClient } from "@supabase/supabase-js";
import { isPdf, renderPdfFirstPageToPng } from "@/lib/pdfToImage";

export async function uploadPlanImageFile(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the loosely-typed client already used throughout lib/actions
  supabase: SupabaseClient<any>,
  userId: string,
  file: File,
): Promise<{ url?: string; error?: string }> {
  let bytes: Uint8Array = new Uint8Array(await file.arrayBuffer());
  let contentType = file.type;
  let filename = file.name;

  if (isPdf(file)) {
    try {
      const { buffer } = await renderPdfFirstPageToPng(bytes);
      bytes = buffer;
      contentType = "image/png";
      filename = filename.replace(/\.pdf$/i, "") + ".png";
    } catch (err) {
      return { error: `Could not convert that PDF to an image: ${err instanceof Error ? err.message : "unknown error"}` };
    }
  }

  const path = `${userId}/${Date.now()}-${filename}`;
  const { error: uploadError } = await supabase.storage
    .from("plan-images")
    .upload(path, bytes, { contentType });
  if (uploadError) return { error: uploadError.message };

  const { data: publicUrl } = supabase.storage.from("plan-images").getPublicUrl(path);
  return { url: publicUrl.publicUrl };
}
