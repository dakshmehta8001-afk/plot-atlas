"use client";

// Interactive leads + site-visits table shared by the sub-admin dashboard
// (scoped to one project) and the admin dashboard (platform-wide). Each row
// lets the sub-admin update the lead's status and schedule/update a site
// visit inline, covering "the sub-admin should see all visits" from the
// spec, without navigating away.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateLeadStatus } from "@/lib/actions/leads";
import { scheduleSiteVisit, updateSiteVisitStatus } from "@/lib/actions/site-visits";
import { LEAD_STATUS_OPTIONS, SITE_VISIT_STATUS_OPTIONS, type LeadStatus, type SiteVisitStatus } from "@/lib/types";

export interface LeadRow {
  id: string;
  message: string | null;
  status: LeadStatus;
  created_at: string;
  unit_label: string;
  viewer_name: string | null;
  viewer_email: string | null;
  site_visits: { id: string; scheduled_at: string | null; status: SiteVisitStatus }[];
}

export function LeadsTable({ leads, editable }: { leads: LeadRow[]; editable: boolean }) {
  const router = useRouter();
  const [visitDrafts, setVisitDrafts] = useState<Record<string, string>>({});

  async function handleStatusChange(lead: LeadRow, status: LeadStatus) {
    await updateLeadStatus(lead.id, status);
    router.refresh();
  }

  async function handleScheduleVisit(lead: LeadRow) {
    const value = visitDrafts[lead.id];
    if (!value) return;
    await scheduleSiteVisit(lead.id, new Date(value).toISOString(), null);
    router.refresh();
  }

  async function handleVisitStatusChange(visitId: string, status: SiteVisitStatus) {
    await updateSiteVisitStatus(visitId, status);
    router.refresh();
  }

  if (leads.length === 0) return <p className="text-gray-500">No leads yet.</p>;

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
      <table className="w-full text-left text-sm">
        <thead className="bg-gray-50 dark:bg-gray-900">
          <tr>
            <th className="p-3">Unit</th>
            <th className="p-3">Viewer</th>
            <th className="p-3">Message</th>
            <th className="p-3">Status</th>
            <th className="p-3">Site visit</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
          {leads.map((lead) => (
            <tr key={lead.id} className="align-top">
              <td className="p-3 font-medium">{lead.unit_label}</td>
              <td className="p-3">
                <p>{lead.viewer_name ?? "—"}</p>
                <p className="text-xs text-gray-500">{lead.viewer_email ?? "—"}</p>
              </td>
              <td className="max-w-xs p-3 text-gray-600 dark:text-gray-400">{lead.message ?? "—"}</td>
              <td className="p-3">
                {editable ? (
                  <select
                    value={lead.status}
                    onChange={(e) => handleStatusChange(lead, e.target.value as LeadStatus)}
                    className="rounded-md border border-gray-300 p-1.5 text-sm dark:border-gray-700 dark:bg-gray-900"
                  >
                    {LEAD_STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="capitalize">{lead.status}</span>
                )}
              </td>
              <td className="p-3">
                {lead.site_visits.length > 0 ? (
                  <ul className="space-y-1">
                    {lead.site_visits.map((visit) => (
                      <li key={visit.id} className="flex items-center gap-2">
                        <span>{visit.scheduled_at ? new Date(visit.scheduled_at).toLocaleString() : "TBD"}</span>
                        {editable ? (
                          <select
                            value={visit.status}
                            onChange={(e) => handleVisitStatusChange(visit.id, e.target.value as SiteVisitStatus)}
                            className="rounded-md border border-gray-300 p-1 text-xs dark:border-gray-700 dark:bg-gray-900"
                          >
                            {SITE_VISIT_STATUS_OPTIONS.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-xs capitalize text-gray-500">{visit.status}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : editable ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="datetime-local"
                      onChange={(e) => setVisitDrafts((d) => ({ ...d, [lead.id]: e.target.value }))}
                      className="rounded-md border border-gray-300 p-1 text-xs dark:border-gray-700 dark:bg-gray-900"
                    />
                    <button
                      onClick={() => handleScheduleVisit(lead)}
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                    >
                      Schedule
                    </button>
                  </div>
                ) : (
                  <span className="text-xs text-gray-500">None scheduled</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
