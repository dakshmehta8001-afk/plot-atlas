"use server";

// Server Actions for the two password-based flows: admin/sub-admin login,
// and sub-admin signup (which creates an account that starts out `pending`
// until an admin approves it — see lib/actions/admin.ts). Viewers never use
// these; they sign in with Google directly from the client (see
// useEnquiryFlow.ts / AuthButtons.tsx), since that flow needs a browser
// redirect rather than a form post.
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export interface ActionResult {
  error?: string;
}

export async function login(formData: FormData): Promise<ActionResult> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };

  // Route the signed-in user to the dashboard matching their role, so admins
  // and sub-admins don't land on the public viewer homepage after login.
  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", data.user.id)
    .single();

  if (profile?.role === "admin") redirect("/admin");
  if (profile?.role === "sub_admin") redirect("/dashboard");
  redirect("/");
}

export async function signUpSubAdmin(formData: FormData): Promise<ActionResult> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const name = String(formData.get("name") ?? "");
  const phone = String(formData.get("phone") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Read by the handle_new_user() trigger (see the init_schema
      // migration) to set role='sub_admin' and status='pending' on the new
      // public.users row.
      data: { role: "sub_admin", name, phone },
    },
  });
  if (error) return { error: error.message };

  redirect("/signup/pending");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
