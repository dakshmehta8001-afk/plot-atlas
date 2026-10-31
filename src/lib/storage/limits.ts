// Canonical bucket configuration, mirroring migration
// 20261028000500_bucket_upload_limits.sql. All picker accept= attributes,
// error messages, and pre-upload checks import from here rather than
// duplicating the values.

export const PLAN_IMAGES_BUCKET = "plan-images" as const;
export const PROJECT_MEDIA_BUCKET = "project-media" as const;
export type StorageBucket = typeof PLAN_IMAGES_BUCKET | typeof PROJECT_MEDIA_BUCKET;

// MIME types that Supabase Storage accepts for each bucket. PDF is not
// listed here because it is converted to PNG in the browser before upload.
export const STORAGE_TYPES: Record<StorageBucket, readonly string[]> = {
  "plan-images": ["image/jpeg", "image/png", "image/webp"],
  "project-media": ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm"],
};

// accept= value for <input type="file">. plan-images includes PDF because
// pdfToImageClient.ts converts it to PNG before the upload reaches Storage.
export const ACCEPT: Record<StorageBucket, string> = {
  "plan-images": "image/jpeg,image/png,image/webp,application/pdf",
  "project-media": "image/jpeg,image/png,image/webp,video/mp4,video/webm",
};

// Maximum file size in MB, matching each bucket's size_limit.
export const MAX_MB: Record<StorageBucket, number> = {
  "plan-images": 20,
  "project-media": 50,
};
