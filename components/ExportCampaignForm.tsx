"use client";

import { useState } from "react";
import { FileDown } from "lucide-react";
import type { Campaign } from "@/lib/data/types";

export function ExportCampaignForm({ campaigns }: { campaigns: Campaign[] }) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const toggle = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const allSelected = campaigns.length > 0 && selectedIds.length === campaigns.length;

  const toggleAll = () => {
    setSelectedIds(allSelected ? [] : campaigns.map((c) => c.id));
  };

  const handleExport = () => {
    if (selectedIds.length === 0) return;
    window.location.href = `/api/people/export?campaignIds=${selectedIds.join(",")}`;
  };

  return (
    <form className="surface grid gap-3 p-5" onSubmit={(e) => { e.preventDefault(); handleExport(); }}>
      <div>
        <h2 className="section-title">Export by Campaign</h2>
        <p className="muted-copy mt-1">Download all people in selected campaigns as a CSV.</p>
      </div>
      <div className="grid gap-1.5 max-h-40 overflow-y-auto">
        {campaigns.length === 0 ? (
          <p className="text-sm text-slate-500">No campaigns found.</p>
        ) : (
          <>
            <label className="flex items-center gap-2 text-sm text-slate-600 border-b border-slate-100 pb-1.5 mb-0.5 cursor-pointer">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                className="h-4 w-4 rounded border-slate-300 accent-blue-600"
              />
              <span className="font-semibold">All campaigns</span>
            </label>
            {campaigns.map((campaign) => (
              <label key={campaign.id} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(campaign.id)}
                  onChange={() => toggle(campaign.id)}
                  className="h-4 w-4 rounded border-slate-300 accent-blue-600"
                />
                {campaign.name}
              </label>
            ))}
          </>
        )}
      </div>
      <button className="button-secondary" type="submit" disabled={selectedIds.length === 0}>
        <FileDown size={16} />
        {selectedIds.length > 0
          ? `Export ${selectedIds.length} campaign${selectedIds.length > 1 ? "s" : ""}`
          : "Export CSV"}
      </button>
    </form>
  );
}
