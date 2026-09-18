// Layout for the whole sub-admin dashboard. src/proxy.ts already redirects
// anyone who isn't role='sub_admin' away from /dashboard/*; this layout adds
// the one thing proxy can't easily express — blocking actual dashboard use
// (not just the route) while the sub-admin's account is still pending
// approval or has been rejected by an admin.
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("users").select("status").eq("id", user.id).single();

  if (profile?.status !== "active") {
    return (
      <main className="mx-auto w-full max-w-lg px-4 py-16 text-center">
        <h1 className="mb-3 text-xl font-semibold">
          {profile?.status === "rejected" ? "Account not approved" : "Account pending approval"}
        </h1>
        <p className="text-sm text-gray-500">
          {profile?.status === "rejected"
            ? "Your sub-admin account request was not approved. Contact the platform admin for details."
            : "An admin still needs to approve your sub-admin account before you can manage projects."}
        </p>
      </main>
    );
  }

  return <div className="mx-auto w-full max-w-6xl px-4 py-8">{children}</div>;
}
