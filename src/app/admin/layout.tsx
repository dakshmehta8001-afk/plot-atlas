// Layout for the whole admin dashboard. Role gating already happens in
// src/proxy.ts (redirects anyone whose role isn't 'admin' away from
// /admin/*); this just provides the shared page chrome plus a section nav.
import { AdminTabs } from "./AdminTabs";

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 text-white sm:px-6 sm:py-10">
      <AdminTabs />
      {children}
    </div>
  );
}
