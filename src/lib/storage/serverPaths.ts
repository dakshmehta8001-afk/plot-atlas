// Server-side path validation for storage paths received from the browser.
// Call this from server actions (or helpers they call) before trusting a
// path from the client. Never accept a URL from the client — the server
// constructs the public URL here.
//
// Not a "use server" file so it can be imported by both server actions and
// other server-only helpers.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StorageBucket } from "@/lib/storage/limits";

export function getValidatedPublicUrl(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the loose client type used throughout lib/actions
  supabase: SupabaseClient<any>,
  bucket: StorageBucket,
  path: string,
  userId: string,
): { url: string } | { error: string } {
  // Block traversal attacks and cross-owner paths.
  if (!path.startsWith(`${userId}/`) || path.includes("..")) {
    return { error: "Invalid file path." };
  }
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return { url: data.publicUrl };
}
