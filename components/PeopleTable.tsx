"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import Link from "next/link";
import { ChevronDown, ChevronUp, ChevronsUpDown, FileDown, Mail, Megaphone, Search, Sparkles, Trash2, X } from "lucide-react";
import type { Campaign, Person, PersonStatus } from "@/lib/data/types";
import { assignCampaign, deleteSelectedPeople, enrichSelectedPeople, findEmailsForPeople, runPeopleBatchOutreach } from "@/app/actions";
import type { EnrichResult } from "@/app/actions";
import { EnrichResultDialog } from "./EnrichResultDialog";

type SortKey = "name" | "title" | "companyName" | "campaignId" | "location" | "status";
type SortDirection = "asc" | "desc";

const PERSON_STATUSES: PersonStatus[] = ["candidate", "new", "drafting", "failed", "approved", "contacted"];

// Shared between the header, filter, and virtualized body rows so columns stay aligned.
const GRID_TEMPLATE_COLUMNS =
  "40px minmax(150px,1.2fr) minmax(160px,1.3fr) minmax(130px,1fr) minmax(120px,0.9fr) minmax(130px,1fr) 110px 110px";
const ROW_HEIGHT = 49;
const VIEWPORT_HEIGHT = 560;

type ColumnFilters = {
  name: string;
  title: string;
  companyName: string;
  campaignId: string;
  location: string;
  status: PersonStatus | "";
  email: "has" | "missing" | "";
};

const emptyColumnFilters: ColumnFilters = {
  name: "",
  title: "",
  companyName: "",
  campaignId: "",
  location: "",
  status: "",
  email: ""
};

function StatusBadge({ status }: { status: PersonStatus }) {
  const cls =
    status === "approved" ? "bg-emerald-50 text-emerald-700" :
    status === "contacted" ? "bg-blue-50 text-blue-700" :
    status === "failed" ? "bg-red-50 text-red-700" :
    status === "drafting" ? "bg-amber-50 text-amber-700" :
    status === "new" ? "bg-sentry-50 text-sentry-800" :
    "bg-slate-100 text-slate-600";
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>;
}


function GenerateEmailButton({ disabled, count }: { disabled: boolean; count: number }) {
  const { pending } = useFormStatus();
  return (
    <button className="button-primary" disabled={disabled || pending} type="submit">
      <Mail size={15} />
      {pending ? "Generating..." : count > 1 ? `Generate ${count} emails` : "Generate email"}
    </button>
  );
}

function ApplyCampaignButton() {
  const { pending } = useFormStatus();
  return (
    <button className="button-secondary" disabled={pending} type="submit">
      <Megaphone size={14} />
      {pending ? "Applying..." : "Apply"}
    </button>
  );
}

function SortableHeader({
  label,
  sortKeyName,
  activeSortKey,
  direction,
  onSort
}: {
  label: string;
  sortKeyName: SortKey;
  activeSortKey: SortKey | null;
  direction: SortDirection;
  onSort: (key: SortKey) => void;
}) {
  const isActive = activeSortKey === sortKeyName;
  const Icon = isActive ? (direction === "asc" ? ChevronUp : ChevronDown) : ChevronsUpDown;
  return (
    <div role="columnheader" className="px-4 py-3 font-semibold text-slate-700">
      <button
        type="button"
        onClick={() => onSort(sortKeyName)}
        className={`inline-flex items-center gap-1 hover:text-ink ${isActive ? "text-ink" : ""}`}
      >
        {label}
        <Icon size={13} />
      </button>
    </div>
  );
}

function ColumnFilterInput({
  value,
  onChange,
  placeholder
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="field w-full px-2 py-1.5 text-xs font-normal"
    />
  );
}

function compareValues(a: Person, b: Person, key: SortKey, campaignNameById: Map<string, string>) {
  if (key === "campaignId") {
    const aName = campaignNameById.get(a.campaignId) || "";
    const bName = campaignNameById.get(b.campaignId) || "";
    return aName.localeCompare(bName);
  }
  const aValue = (a[key] as string | undefined) || "";
  const bValue = (b[key] as string | undefined) || "";
  return aValue.localeCompare(bValue);
}

export function PeopleTable({ people, campaigns }: { people: Person[]; campaigns: Campaign[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [columnFilters, setColumnFilters] = useState<ColumnFilters>(emptyColumnFilters);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [targetCampaignId, setTargetCampaignId] = useState(campaigns[0]?.id || "");
  const scrollParentRef = useRef<HTMLDivElement>(null);
  const [isDeleting, startDeleteTransition] = useTransition();
  const [isEnriching, startEnrichTransition] = useTransition();
  const [isFindingEmails, startFindEmailsTransition] = useTransition();
  const [enrichResult, setEnrichResult] = useState<EnrichResult | null>(null);
  const [findEmailResult, setFindEmailResult] = useState<EnrichResult | null>(null);

  const handleDelete = useCallback(() => {
    const ids = Array.from(selected);
    if (!window.confirm(`Delete ${ids.length} ${ids.length === 1 ? "person" : "people"}? This cannot be undone.`)) return;
    startDeleteTransition(async () => {
      await deleteSelectedPeople(ids);
      setSelected(new Set());
    });
  }, [selected]);

  const handleEnrich = useCallback(() => {
    const ids = Array.from(selected);
    startEnrichTransition(async () => {
      const result = await enrichSelectedPeople(ids);
      setEnrichResult(result);
      setSelected(new Set());
    });
  }, [selected]);

  const handleFindEmails = useCallback(() => {
    const ids = Array.from(selected);
    startFindEmailsTransition(async () => {
      const result = await findEmailsForPeople(ids);
      setFindEmailResult(result);
      setSelected(new Set());
    });
  }, [selected]);

  const campaignNameById = useMemo(() => new Map(campaigns.map((c) => [c.id, c.name])), [campaigns]);

  const updateColumnFilter = useCallback(<K extends keyof ColumnFilters>(key: K, value: ColumnFilters[K]) => {
    setColumnFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const hasActiveFilters =
    searchTerm.trim() !== "" || Object.values(columnFilters).some((value) => value !== "");

  const clearAllFilters = useCallback(() => {
    setSearchTerm("");
    setColumnFilters(emptyColumnFilters);
  }, []);

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return people.filter((person) => {
      if (term && ![person.name, person.title, person.companyName, person.location].some((field) => field?.toLowerCase().includes(term))) {
        return false;
      }
      if (columnFilters.name && !person.name.toLowerCase().includes(columnFilters.name.toLowerCase())) return false;
      if (columnFilters.title && !(person.title || "").toLowerCase().includes(columnFilters.title.toLowerCase())) return false;
      if (columnFilters.companyName && !(person.companyName || "").toLowerCase().includes(columnFilters.companyName.toLowerCase())) return false;
      if (columnFilters.campaignId && person.campaignId !== columnFilters.campaignId) return false;
      if (columnFilters.location && !(person.location || "").toLowerCase().includes(columnFilters.location.toLowerCase())) return false;
      if (columnFilters.status && person.status !== columnFilters.status) return false;
      if (columnFilters.email === "has" && !person.email) return false;
      if (columnFilters.email === "missing" && person.email) return false;
      return true;
    });
  }, [people, searchTerm, columnFilters]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const direction = sortDirection === "asc" ? 1 : -1;
    return filtered.slice().sort((a, b) => compareValues(a, b, sortKey, campaignNameById) * direction);
  }, [filtered, sortKey, sortDirection, campaignNameById]);

  const virtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10
  });

  const handleSort = useCallback(
    (key: SortKey) => {
      if (sortKey === key) {
        setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDirection("asc");
      }
    },
    [sortKey]
  );

  const allSelected = sorted.length > 0 && sorted.every((p) => selected.has(p.id));
  const someSelected = sorted.some((p) => selected.has(p.id)) && !allSelected;
  const selectedIds = Array.from(selected);


  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allVisibleSelected = sorted.length > 0 && sorted.every((p) => next.has(p.id));
      sorted.forEach((p) => (allVisibleSelected ? next.delete(p.id) : next.add(p.id)));
      return next;
    });
  }, [sorted]);

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
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[260px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="     Search by name, title, company, or location"
            className="field w-full pl-9"
          />
        </div>
        {hasActiveFilters ? (
          <button type="button" onClick={clearAllFilters} className="button-secondary px-3 py-1.5 text-sm">
            <X size={14} />
            Clear Filters
          </button>
        ) : null}
      </div>
      <p className="mb-3 text-xs text-slate-500">Use the boxes under each column header below to filter by that column.</p>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">
            {selected.size > 0 ? `${selected.size} selected` : `${sorted.length} of ${people.length} people`}
          </p>
          {selected.size === 1 ? (
            <p className="mt-1 text-xs text-slate-500">This can take 30-90 seconds while search and OpenAI run.</p>
          ) : selected.size > 1 ? (
            <p className="mt-1 text-xs text-slate-500">Runs in the background — you can keep browsing while it processes.</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {selected.size > 0 ? (
            <button
              type="button"
              onClick={handleDelete}
              disabled={isDeleting || isEnriching}
              className="button-secondary border-red-200 text-red-600 hover:bg-red-50"
            >
              <Trash2 size={14} />
              {isDeleting ? "Deleting..." : `Delete ${selected.size}`}
            </button>
          ) : null}
          {selected.size > 0 ? (
            <button
              type="button"
              onClick={handleEnrich}
              disabled={isEnriching || isDeleting || isFindingEmails}
              className="button-secondary"
            >
              <Sparkles size={14} />
              {isEnriching ? "Searching LinkedIn…" : "Find missing info"}
            </button>
          ) : null}
          {selected.size > 0 ? (
            <button
              type="button"
              onClick={handleFindEmails}
              disabled={isFindingEmails || isEnriching || isDeleting}
              className="button-secondary"
            >
              <Mail size={14} />
              {isFindingEmails ? "Finding emails…" : "Find emails"}
            </button>
          ) : null}
          {selected.size > 0 ? (
            <form action={assignCampaign} className="flex items-center gap-2">
              {selectedIds.map((personId) => (
                <input key={personId} type="hidden" name="personIds" value={personId} />
              ))}
              <select
                name="campaignId"
                value={targetCampaignId}
                onChange={(event) => setTargetCampaignId(event.target.value)}
                className="field px-2 py-1.5 text-sm"
              >
                {campaigns.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.name}
                  </option>
                ))}
              </select>
              <ApplyCampaignButton />
            </form>
          ) : null}
          <form action={runPeopleBatchOutreach} className="flex items-center gap-2">
            {selectedIds.map((personId) => (
              <input key={personId} type="hidden" name="candidateIds" value={personId} />
            ))}
            {columnFilters.campaignId ? (
              <a className="button-secondary" href={`/api/people/export?campaignIds=${columnFilters.campaignId}`}>
                <FileDown size={15} />
                Export Campaign
              </a>
            ) : null}
            {selected.size > 0 ? (
              <a className="button-secondary" href={`/api/people/export?ids=${selectedIds.join(",")}`}>
                <FileDown size={15} />
                Export selected
              </a>
            ) : (
              <button className="button-secondary" type="button" disabled>
                <FileDown size={15} />
                Export selected
              </button>
            )}
            <GenerateEmailButton disabled={selected.size === 0} count={selected.size} />
          </form>
        </div>
      </div>

      <div className="surface overflow-hidden">
        <div className="overflow-x-auto">
          <div role="table" style={{ minWidth: 1000 }} className="text-sm">
            <div role="rowgroup" className="sticky top-0 z-10 bg-slate-50">
              <div role="row" style={{ display: "grid", gridTemplateColumns: GRID_TEMPLATE_COLUMNS }} className="border-b border-slate-200 text-left">
                <div className="flex items-center px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected; }}
                    onChange={toggleAll}
                    className="h-4 w-4 rounded border-slate-300 accent-blue-600"
                  />
                </div>
                <SortableHeader label="Name" sortKeyName="name" activeSortKey={sortKey} direction={sortDirection} onSort={handleSort} />
                <SortableHeader label="Title" sortKeyName="title" activeSortKey={sortKey} direction={sortDirection} onSort={handleSort} />
                <SortableHeader label="Company" sortKeyName="companyName" activeSortKey={sortKey} direction={sortDirection} onSort={handleSort} />
                <SortableHeader label="Campaign" sortKeyName="campaignId" activeSortKey={sortKey} direction={sortDirection} onSort={handleSort} />
                <SortableHeader label="Location" sortKeyName="location" activeSortKey={sortKey} direction={sortDirection} onSort={handleSort} />
                <SortableHeader label="Status" sortKeyName="status" activeSortKey={sortKey} direction={sortDirection} onSort={handleSort} />
                <div role="columnheader" className="px-4 py-3 font-semibold text-slate-700">Email</div>
              </div>
              <div role="row" style={{ display: "grid", gridTemplateColumns: GRID_TEMPLATE_COLUMNS }} className="border-b border-slate-200 bg-slate-50/60">
                <div className="px-4 py-2" />
                <div className="px-2 py-2">
                  <ColumnFilterInput value={columnFilters.name} onChange={(value) => updateColumnFilter("name", value)} placeholder="Filter name" />
                </div>
                <div className="px-2 py-2">
                  <ColumnFilterInput value={columnFilters.title} onChange={(value) => updateColumnFilter("title", value)} placeholder="Filter title" />
                </div>
                <div className="px-2 py-2">
                  <ColumnFilterInput
                    value={columnFilters.companyName}
                    onChange={(value) => updateColumnFilter("companyName", value)}
                    placeholder="Filter company"
                  />
                </div>
                <div className="px-2 py-2">
                  <select
                    value={columnFilters.campaignId}
                    onChange={(event) => updateColumnFilter("campaignId", event.target.value)}
                    className="field w-full px-2 py-1.5 text-xs font-normal"
                  >
                    <option value="">All campaigns</option>
                    {campaigns.map((campaign) => (
                      <option key={campaign.id} value={campaign.id}>
                        {campaign.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="px-2 py-2">
                  <ColumnFilterInput
                    value={columnFilters.location}
                    onChange={(value) => updateColumnFilter("location", value)}
                    placeholder="Filter location"
                  />
                </div>
                <div className="px-2 py-2">
                  <select
                    value={columnFilters.status}
                    onChange={(event) => updateColumnFilter("status", event.target.value as PersonStatus | "")}
                    className="field w-full px-2 py-1.5 text-xs font-normal capitalize"
                  >
                    <option value="">All statuses</option>
                    {PERSON_STATUSES.map((status) => (
                      <option key={status} value={status} className="capitalize">
                        {status}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="px-2 py-2">
                  <select
                    value={columnFilters.email}
                    onChange={(event) => updateColumnFilter("email", event.target.value as ColumnFilters["email"])}
                    className="field w-full px-2 py-1.5 text-xs font-normal"
                  >
                    <option value="">All</option>
                    <option value="has">Has email</option>
                    <option value="missing">No email</option>
                  </select>
                </div>
              </div>
            </div>

            {sorted.length === 0 ? (
              <div className="px-4 py-12 text-center text-slate-500">
                {people.length === 0
                  ? "No people found. Add a person or run lead generation to populate this list."
                  : "No people match your filters."}
              </div>
            ) : (
              <div ref={scrollParentRef} style={{ height: VIEWPORT_HEIGHT }} className="overflow-y-auto">
                <div role="rowgroup" style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }} className="divide-y divide-slate-100">
                  {virtualizer.getVirtualItems().map((virtualRow) => {
                    const person = sorted[virtualRow.index];
                    const isSelected = selected.has(person.id);
                    const campaignName = campaignNameById.get(person.campaignId) || "Unknown";
                    return (
                      <div
                        key={person.id}
                        data-index={virtualRow.index}
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          height: virtualRow.size,
                          transform: `translateY(${virtualRow.start}px)`,
                          display: "grid",
                          gridTemplateColumns: GRID_TEMPLATE_COLUMNS
                        }}
                        role="row"
                        className={`items-center border-b border-slate-100 transition-colors ${isSelected ? "bg-blue-50/60" : "hover:bg-slate-50"}`}
                        onClick={() => toggleOne(person.id)}
                      >
                        <div role="cell" className="px-4" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleOne(person.id)}
                            className="h-4 w-4 rounded border-slate-300 accent-blue-600"
                          />
                        </div>
                        <div role="cell" className="truncate px-4 font-semibold text-ink">
                          <Link href={`/people/${person.id}`} className="hover:text-blue-600 hover:underline" onClick={(e) => e.stopPropagation()}>
                            {person.name}
                          </Link>
                        </div>
                        <div role="cell" title={person.title} className="truncate px-4 text-slate-600">
                          {person.title || "—"}
                        </div>
                        <div role="cell" title={person.companyName} className="truncate px-4 text-slate-600">
                          {person.companyName || "—"}
                        </div>
                        <div role="cell" title={campaignName} className="truncate px-4 text-slate-600">
                          {campaignName}
                        </div>
                        <div role="cell" title={person.location} className="truncate px-4 text-slate-500">
                          {person.location || "—"}
                        </div>
                        <div role="cell" className="px-4">
                          <StatusBadge status={person.status} />
                        </div>
                        <div role="cell" className="px-4">
                          {person.email ? (
                            <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${person.emailVerified ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                              {person.emailVerified ? "Verified" : "Has Email"}
                            </span>
                          ) : (
                            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">
                              No Email
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {enrichResult ? (
        <EnrichResultDialog
          result={enrichResult}
          campaigns={campaigns}
          onClose={() => setEnrichResult(null)}
        />
      ) : null}
      {findEmailResult ? (
        <EnrichResultDialog
          result={findEmailResult}
          campaigns={campaigns}
          onClose={() => setFindEmailResult(null)}
          title="Email Lookup Complete"
          enrichedLabel="found"
          skippedLabel="already verified"
          failedLabel="not found"
        />
      ) : null}
    </div>
  );
}
