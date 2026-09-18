// Layout for the whole admin dashboard. Role gating already happens in
// src/proxy.ts (redirects anyone whose role isn't 'admin' away from
// /admin/*); this just provides the shared page chrome plus a small
// section nav between the admin views.
import Link from "next/link";

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <nav className="mb-6 flex gap-4 border-b border-gray-200 pb-3 text-sm dark:border-gray-800">
        <Link href="/admin" className="font-medium hover:underline">
          Overview
        </Link>
        <Link href="/admin/sub-admins" className="hover:underline">
          Sub-admins
        </Link>
        <Link href="/admin/projects" className="hover:underline">
          Projects
        </Link>
        <Link href="/admin/leads" className="hover:underline">
          Leads
        </Link>
      </nav>
      {children}
    </div>
  );
}
