"use client";

// Browser-side upload helper. Validates MIME type and size against the
// bucket rules in limits.ts before touching Storage. On success, also reads
// image dimensions via createImageBitmap so callers can store width/height
// without a separate server round-trip.
//
// Returns { path, width?, height? } on success or { error } on failure.
//
// Must only be imported from client components — it uses browser APIs
// (createImageBitmap) and the browser Supabase client.
import { createClient } from "@/lib/supabase/client";
import { STORAGE_TYPES, MAX_MB, type StorageBucket } from "@/lib/storage/limits";
import { WRONG_TYPE_MESSAGE, storageUploadErrorMessage } from "@/lib/utils/storageUploadError";

// Safe filename: keep only letters, numbers, dashes, and dots.
function safeName(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9.\-]/g, "-");
}

export type UploadSuccess = { path: string; width?: number; height?: number };
export type UploadError = { error: string };
export type UploadResult = UploadSuccess | UploadError;

export async function uploadFromBrowser(
  bucket: StorageBucket,
  fileOrBlob: File | Blob,
  filename: string,
): Promise<UploadResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  // Blob.type is always set when the blob comes from canvas.toBlob; File.type
  // is set by the browser from the file's magic bytes and extension.
  const mimeType = fileOrBlob.type || "application/octet-stream";

  if (!(STORAGE_TYPES[bucket] as readonly string[]).includes(mimeType)) {
    return { error: WRONG_TYPE_MESSAGE };
  }

  if (fileOrBlob.size > MAX_MB[bucket] * 1024 * 1024) {
    return { error: `This file is too large. The limit is ${MAX_MB[bucket]} MB.` };
  }

  const path = `${user.id}/${Date.now()}-${safeName(filename)}`;
  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(path, fileOrBlob, { contentType: mimeType });
  if (uploadError) {
    return { error: storageUploadErrorMessage(uploadError, bucket) ?? uploadError.message };
  }

  // Read pixel dimensions for images (optional — upload already succeeded).
  let width: number | undefined;
  let height: number | undefined;
  if (mimeType.startsWith("image/")) {
    try {
      const bitmap = await createImageBitmap(fileOrBlob);
      width = bitmap.width;
      height = bitmap.height;
      bitmap.close();
    } catch {
      // Dimensions are optional; proceed without them.
    }
  }

  return { path, width, height };
}
