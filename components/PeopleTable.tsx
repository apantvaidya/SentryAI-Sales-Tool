"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { Mail } from "lucide-react";
import type { LeadCandidateStatus } from "@/lib/data/types";

type CandidateRow = {
  id: string;
  prospectId: string;
  prospectCompanyName: string;
  fullName: string;
  currentTitle?: string;
  currentCompany?: string;
  resolvedLocation?: string;
  linkedinUrl?: string;
  status: LeadCandidateStatus;
  overlapCount: number;
  sourceQueryNames?: string[];
  sourceQueryIds: string[];
};

function StatusBadge({ status }: { status: LeadCandidateStatus }) {
  const cls =
    status === "accepted" ? "bg-emerald-50 text-emerald-700" :
    status === "imported" ? "bg-blue-50 text-blue-700" :
    status === "needs_review" ? "bg-amber-50 text-amber-700" :
    "bg-slate-100 text-slate-600";
  const label =
    status === "needs_review" ? "Review" :
    status.charAt(0).toUpperCase() + status.slice(1);
  return <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>;
}

export function PeopleTable({ candidates }: { candidates: CandidateRow[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const allSelected = candidates.length > 0 && selected.size === candidates.length;
  const someSelected = selected.size > 0 && !allSelected;

  const toggleAll = useCallback(() => {
    setSelected(allSelected ? new Set() : new Set(candidates.map((c) => c.id)));
  }, [allSelected, candidates]);

  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <p className="text-sm text-slate-500">
          {selected.size > 0 ? `${selected.size} selected` : `${candidates.length} people`}
        </p>
        <button
          className="button-primary"
          disabled={selected.size === 0}
          onClick={() => {}}
        >
          <Mail size={15} />
          Generate emails for selected
        </button>
      </div>

      <div className="surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left">
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected; }}
                    onChange={toggleAll}
                    className="h-4 w-4 rounded border-slate-300 accent-blue-600"
                  />
                </th>
                <th className="px-4 py-3 font-semibold text-slate-700">Name</th>
                <th className="px-4 py-3 font-semibold text-slate-700">Title</th>
                <th className="px-4 py-3 font-semibold text-slate-700">Company</th>
                <th className="px-4 py-3 font-semibold text-slate-700">Location</th>
                <th className="px-4 py-3 font-semibold text-slate-700">Status</th>
                <th className="px-4 py-3 font-semibold text-slate-700">Prospect</th>
                <th className="px-4 py-3 font-semibold text-slate-700">Queries</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {candidates.map((candidate) => {
                const isSelected = selected.has(candidate.id);
                const queries = candidate.sourceQueryNames?.length
                  ? candidate.sourceQueryNames
                  : candidate.sourceQueryIds;
                return (
                  <tr
                    key={candidate.id}
                    className={`transition-colors ${isSelected ? "bg-blue-50/60" : "hover:bg-slate-50"}`}
                    onClick={() => toggleOne(candidate.id)}
                  >
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleOne(candidate.id)}
                        className="h-4 w-4 rounded border-slate-300 accent-blue-600"
                      />
                    </td>
                    <td className="px-4 py-3 font-semibold text-ink">
                      {candidate.linkedinUrl ? (
                        <a
                          href={candidate.linkedinUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-blue-600 hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {candidate.fullName}
                        </a>
                      ) : (
                        candidate.fullName
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{candidate.currentTitle || "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{candidate.currentCompany || "—"}</td>
                    <td className="px-4 py-3 text-slate-500">{candidate.resolvedLocation || "—"}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={candidate.status} />
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/prospects/${candidate.prospectId}/candidates`}
                        className="text-slate-600 hover:text-blue-600 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {candidate.prospectCompanyName}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-slate-500">
                        {queries.slice(0, 2).join(", ")}
                        {queries.length > 2 ? ` +${queries.length - 2}` : ""}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {candidates.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-slate-500">
                    No people found. Run lead generation on a prospect to populate this list.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
