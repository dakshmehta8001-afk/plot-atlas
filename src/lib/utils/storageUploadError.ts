// Plain-language messages for a file that Supabase Storage refused because of
// the bucket limits (supabase/migrations/20261028000500_bucket_upload_limits.sql):
//   plan-images   20 MB, JPEG/PNG/WebP
//   project-media 50 MB, JPEG/PNG/WebP, MP4/WebM
// Storage reports a wrong type as HTTP 415 "mime type ... is not supported"
// and a file over the limit as HTTP 413 "The object exceeded the maximum
// allowed size". Anything else is passed through unchanged.
//
// Kept outside the "use server" action files because those may only export
// async functions.

export const BUCKET_LIMIT_MB = { "plan-images": 20, "project-media": 50 } as const;
export type LimitedBucket = keyof typeof BUCKET_LIMIT_MB;

export const WRONG_TYPE_MESSAGE =
  "This file type isn't allowed. Use JPG, PNG or WebP for images, and MP4 or WebM for videos.";

export function storageUploadErrorMessage(
  error: { message?: string; status?: number; statusCode?: string | number } | null,
  bucket: LimitedBucket,
): string | null {
  if (!error) return null;
  const message = error.message ?? "";
  const status = Number(error.status ?? error.statusCode);
  if (status === 415 || /mime type|invalid_mime_type|not supported/i.test(message)) {
    return WRONG_TYPE_MESSAGE;
  }
  if (status === 413 || /maximum allowed size|too large|payload/i.test(message)) {
    return `This file is too large. The limit is ${BUCKET_LIMIT_MB[bucket]} MB.`;
  }
  return message || "Upload failed.";
}
