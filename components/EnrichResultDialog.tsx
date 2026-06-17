"use client";

import { useCallback, useState, useTransition } from "react";
import Link from "next/link";
import { ExternalLink, Megaphone, Trash2, X } from "lucide-react";
import type { Campaign } from "@/lib/data/types";
import type { EnrichResult } from "@/app/actions";
import { assignCampaign, deleteSelectedPeople } from "@/app/actions";

export function EnrichResultDialog({
  result,
  campaigns,
  onClose,
  title = "Enrichment Complete",
  enrichedLabel = "updated",
  skippedLabel = "already complete",
  failedLabel = "could not be enriched",
}: {
  result: EnrichResult;
  campaigns: Campaign[];
  onClose: () => void;
  title?: string;
  enrichedLabel?: string;
  skippedLabel?: string;
  failedLabel?: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    new Set(result.failed.map((f) => f.id))
  );
  const [targetCampaignId, setTargetCampaignId] = useState(campaigns[0]?.id || "");
  const [isDeleting, startDeleteTransition] = useTransition();
  const [isAssigning, startAssignTransition] = useTransition();

  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const allSelected = result.failed.length > 0 && result.failed.every((f) => selected.has(f.id));
  const toggleAll = useCallback(() => {
    setSelected(allSelected ? new Set() : new Set(result.failed.map((f) => f.id)));
  }, [allSelected, result.failed]);

  const handleDelete = useCallback(() => {
    const ids = Array.from(selected);
    if (!window.confirm(`Delete ${ids.length} ${ids.length === 1 ? "person" : "people"}? This cannot be undone.`)) return;
    startDeleteTransition(async () => {
      await deleteSelectedPeople(ids);
      onClose();
    });
  }, [selected, onClose]);

  const handleAssign = useCallback(() => {
    if (!targetCampaignId || selected.size === 0) return;
    const ids = Array.from(selected);
    startAssignTransition(async () => {
      const fd = new FormData();
      fd.append("campaignId", targetCampaignId);
      ids.forEach((id) => fd.append("personIds", id));
      await assignCampaign(fd);
      onClose();
    });
  }, [selected, targetCampaignId, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="surface w-full max-w-lg overflow-hidden shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="section-title">{title}</h2>
            <p className="muted-copy mt-0.5">
              {result.enriched} {enrichedLabel} · {result.skipped} {skippedLabel}
              {result.failed.length > 0 ? ` · ${result.failed.length} ${failedLabel}` : ""}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-ink">
            <X size={18} />
          </button>
        </div>

        {result.failed.length > 0 && (
          <>
            <div className="border-b border-slate-200 px-5 py-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="h-4 w-4 rounded border-slate-300 accent-blue-600"
                />
                Select all ({result.failed.length})
              </label>
            </div>

            <div className="max-h-64 divide-y divide-slate-100 overflow-y-auto">
              {result.failed.map(({ id, name, reason }) => (
                <div key={id} className="flex items-center gap-3 px-5 py-2.5">
                  <input
                    type="checkbox"
                    checked={selected.has(id)}
                    onChange={() => toggleOne(id)}
                    className="h-4 w-4 shrink-0 rounded border-slate-300 accent-blue-600"
                  />
                  <span className="flex-1 truncate text-sm font-medium text-ink">{name}</span>
                  <span className="shrink-0 text-xs text-slate-400">{reason}</span>
                  <Link
                    href={`/people/${id}`}
                    target="_blank"
                    className="shrink-0 text-slate-400 hover:text-blue-600"
                    title="Open profile"
                  >
                    <ExternalLink size={13} />
                  </Link>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-5 py-4">
              <button
                type="button"
                onClick={handleDelete}
                disabled={selected.size === 0 || isDeleting || isAssigning}
                className="button-secondary border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40"
              >
                <Trash2 size={13} />
                {isDeleting ? "Deleting…" : `Delete ${selected.size || ""}`}
              </button>

              <div className="flex items-center gap-1.5">
                <select
                  value={targetCampaignId}
                  onChange={(e) => setTargetCampaignId(e.target.value)}
                  className="field px-2 py-1.5 text-sm"
                  disabled={campaigns.length === 0}
                >
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleAssign}
                  disabled={selected.size === 0 || isDeleting || isAssigning || !targetCampaignId}
                  className="button-secondary disabled:opacity-40"
                >
                  <Megaphone size={13} />
                  {isAssigning ? "Assigning…" : "Assign"}
                </button>
              </div>
            </div>
          </>
        )}

        {result.failed.length === 0 && (
          <div className="px-5 py-8 text-center text-slate-500">
            All selected people were enriched successfully.
          </div>
        )}
      </div>
    </div>
  );
}
