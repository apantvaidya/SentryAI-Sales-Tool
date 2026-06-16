"use client";

import { useState, useCallback } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Mail } from "lucide-react";
import type { Person, PersonStatus } from "@/lib/data/types";
import { runPeopleBatchOutreach } from "@/app/actions";

function StatusBadge({ status }: { status: PersonStatus }) {
  const cls =
    status === "approved" ? "bg-emerald-50 text-emerald-700" :
    status === "contacted" ? "bg-blue-50 text-blue-700" :
    status === "drafting" ? "bg-amber-50 text-amber-700" :
    status === "new" ? "bg-sentry-50 text-sentry-800" :
    "bg-slate-100 text-slate-600";
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>;
}

const MAX_BATCH_OUTREACH = 50;

function GenerateEmailButton({ disabled, count }: { disabled: boolean; count: number }) {
  const { pending } = useFormStatus();
  return (
    <button className="button-primary" disabled={disabled || pending} type="submit">
      <Mail size={15} />
      {pending ? "Generating..." : count > 1 ? `Generate ${count} emails` : "Generate email"}
    </button>
  );
}

export function PeopleTable({ people }: { people: Person[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const allSelected = people.length > 0 && selected.size === people.length;
  const someSelected = selected.size > 0 && !allSelected;
  const selectedIds = Array.from(selected);
  const overBatchLimit = selected.size > MAX_BATCH_OUTREACH;

  const toggleAll = useCallback(() => {
    setSelected(allSelected ? new Set() : new Set(people.map((p) => p.id)));
  }, [allSelected, people]);

  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  return (
    <div>
      <form action={runPeopleBatchOutreach} className="mb-4 flex items-center justify-between gap-4">
        {selectedIds.map((personId) => (
          <input key={personId} type="hidden" name="candidateIds" value={personId} />
        ))}
        <div>
          <p className="text-sm text-slate-500">
            {selected.size > 0 ? `${selected.size} selected` : `${people.length} people`}
          </p>
          {overBatchLimit ? (
            <p className="mt-1 text-xs font-semibold text-amber-700">Select at most {MAX_BATCH_OUTREACH} people at a time to generate emails from this page.</p>
          ) : selected.size === 1 ? (
            <p className="mt-1 text-xs text-slate-500">This can take 30-90 seconds while search and OpenAI run.</p>
          ) : selected.size > 1 ? (
            <p className="mt-1 text-xs text-slate-500">Runs in the background — you can keep browsing while it processes.</p>
          ) : null}
        </div>
        <GenerateEmailButton disabled={selected.size === 0 || overBatchLimit} count={selected.size} />
      </form>

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
                <th className="px-4 py-3 font-semibold text-slate-700">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {people.map((person) => {
                const isSelected = selected.has(person.id);
                return (
                  <tr
                    key={person.id}
                    className={`transition-colors ${isSelected ? "bg-blue-50/60" : "hover:bg-slate-50"}`}
                    onClick={() => toggleOne(person.id)}
                  >
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleOne(person.id)}
                        className="h-4 w-4 rounded border-slate-300 accent-blue-600"
                      />
                    </td>
                    <td className="px-4 py-3 font-semibold text-ink">
                      <Link href={`/people/${person.id}`} className="hover:text-blue-600 hover:underline" onClick={(e) => e.stopPropagation()}>
                        {person.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{person.title || "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{person.companyName || "—"}</td>
                    <td className="px-4 py-3 text-slate-500">{person.location || "—"}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={person.status} />
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-700">{person.confidenceScore}</td>
                  </tr>
                );
              })}
              {people.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                    No people found. Add a person or run lead generation to populate this list.
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
