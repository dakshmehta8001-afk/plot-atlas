"use client";

// Admin's sub-admin management table: approve a pending applicant, or
// reject/reinstate an existing one. Every action here is guarded server-side
// by RLS's "admins update any user" policy, not by anything in this
// component — it's just the UI.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { setSubAdminStatus } from "@/lib/actions/admin";
import type { AppUser } from "@/lib/types";

export function SubAdminsTable({ subAdmins }: { subAdmins: AppUser[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function handleSetStatus(id: string, status: AppUser["status"]) {
    setPendingId(id);
    await setSubAdminStatus(id, status);
    setPendingId(null);
    router.refresh();
  }

  if (subAdmins.length === 0) return <p className="text-gray-500">No sub-admins yet.</p>;

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
      <table className="w-full text-left text-sm">
        <thead className="bg-gray-50 dark:bg-gray-900">
          <tr>
            <th className="p-3">Name</th>
            <th className="p-3">Email</th>
            <th className="p-3">Phone</th>
            <th className="p-3">Status</th>
            <th className="p-3">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
          {subAdmins.map((u) => (
            <tr key={u.id}>
              <td className="p-3">{u.name ?? "—"}</td>
              <td className="p-3">{u.email}</td>
              <td className="p-3">{u.phone ?? "—"}</td>
              <td className="p-3 capitalize">{u.status}</td>
              <td className="p-3">
                <div className="flex gap-2">
                  {u.status !== "active" && (
                    <button
                      onClick={() => handleSetStatus(u.id, "active")}
                      disabled={pendingId === u.id}
                      className="rounded-md bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-500 disabled:opacity-60"
                    >
                      Approve
                    </button>
                  )}
                  {u.status !== "rejected" && (
                    <button
                      onClick={() => handleSetStatus(u.id, "rejected")}
                      disabled={pendingId === u.id}
                      className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-60"
                    >
                      Reject
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
