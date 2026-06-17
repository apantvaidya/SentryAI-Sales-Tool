"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { FilePlus2, Save, Trash2 } from "lucide-react";
import { addQueryTemplate, removeQueryTemplate, updateQueryTargeting, updateQueryTemplate } from "@/app/actions";
import type { QueryTemplate } from "@/lib/leadgen/queryTemplates";
import type { QueryTargeting } from "@/lib/leadgen/queryTargeting";

function SubmitButton({
  children,
  pendingText,
  className
}: {
  children: React.ReactNode;
  pendingText: string;
  className: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending ? pendingText : children}
    </button>
  );
}

function DeleteButton({ fileName }: { fileName: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="button-secondary text-red-700 hover:bg-red-50"
      disabled={pending}
      onClick={(event) => {
        if (!window.confirm(`Delete ${fileName}? Future lead-gen runs will no longer use this query.`)) {
          event.preventDefault();
        }
      }}
    >
      <Trash2 size={15} />
      {pending ? "Deleting..." : "Delete"}
    </button>
  );
}

function TargetingForm({ targeting }: { targeting: QueryTargeting }) {
  return (
    <form action={updateQueryTargeting} className="surface grid gap-3 p-5">
      <div>
        <h2 className="section-title">Location Targeting</h2>
        <p className="muted-copy mt-1">
          This text is appended to every Exa query. The country code is sent to Exa as its API location hint.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-[1fr_160px]">
        <label className="grid gap-1 text-xs font-semibold text-slate-600">
          Query location text
          <input
            className="field"
            name="querySuffix"
            defaultValue={targeting.querySuffix}
            placeholder="Northern California"
            required
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-slate-600">
          Exa country code
          <input
            className="field font-mono uppercase"
            name="userLocation"
            defaultValue={targeting.userLocation}
            pattern="[A-Za-z]{2}"
            maxLength={2}
            placeholder="US"
            required
          />
        </label>
      </div>
      <SubmitButton className="button-primary justify-self-start" pendingText="Saving...">
        <Save size={15} />
        Save targeting
      </SubmitButton>
    </form>
  );
}

function QueryCard({ query }: { query: QueryTemplate }) {
  const [fileName, setFileName] = useState(query.fileName);
  const [content, setContent] = useState(query.content);
  const hasChanges = fileName !== query.fileName || content !== query.content;

  return (
    <article className="surface grid gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="page-kicker">{query.bucket.replace("_", " ")}</p>
          <h2 className="mt-1 text-lg font-bold text-ink">{query.vectorId}</h2>
          <p className="mt-1 text-sm text-slate-500">
            {query.requiresLinkedIn ? "Requires LinkedIn seed URL" : "Runs for every seed"} · Updated{" "}
            {new Date(query.updatedAt).toLocaleString()}
          </p>
        </div>
        {hasChanges ? <span className="rounded-md bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700">Unsaved</span> : null}
      </div>

      <form action={updateQueryTemplate} className="grid gap-3">
        <input type="hidden" name="originalFileName" value={query.fileName} />
        <label className="grid gap-1 text-xs font-semibold text-slate-600">
          File name
          <input
            className="field font-mono text-sm"
            name="fileName"
            value={fileName}
            onChange={(event) => setFileName(event.target.value)}
            pattern="[A-Za-z0-9][A-Za-z0-9_-]*\.txt"
            required
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-slate-600">
          Query text
          <textarea
            className="field min-h-40 resize-y font-mono text-sm leading-6"
            name="content"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            required
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <SubmitButton className="button-primary" pendingText="Saving...">
            <Save size={15} />
            Save
          </SubmitButton>
          <p className="text-xs text-slate-500">Allowed placeholders: {"{{company_name}}"}, {"{{role}}"}, {"{{person_name}}"}, {"{{linkedin_url}}"}</p>
        </div>
      </form>

      <form action={removeQueryTemplate}>
        <input type="hidden" name="fileName" value={query.fileName} />
        <DeleteButton fileName={query.fileName} />
      </form>
    </article>
  );
}

export function QueryTemplateManager({ queries, targeting }: { queries: QueryTemplate[]; targeting: QueryTargeting }) {
  return (
    <div className="grid gap-5">
      <TargetingForm targeting={targeting} />

      <form action={addQueryTemplate} className="surface grid gap-3 p-5">
        <div>
          <h2 className="section-title">New Query</h2>
          <p className="muted-copy mt-1">New `.txt` files are picked up automatically by future Exa lead-gen runs.</p>
        </div>
        <div className="grid gap-3 lg:grid-cols-[minmax(240px,0.45fr)_1fr]">
          <input
            className="field font-mono text-sm"
            name="fileName"
            placeholder="08_similar_company_norcal_security.txt"
            pattern="[A-Za-z0-9][A-Za-z0-9_-]*\.txt"
            required
          />
          <textarea
            className="field min-h-24 resize-y font-mono text-sm leading-6"
            name="content"
            placeholder="people in Northern California at companies similar to {{company_name}} with roles similar to {{role}}"
            required
          />
        </div>
        <SubmitButton className="button-primary justify-self-start" pendingText="Creating...">
          <FilePlus2 size={15} />
          Create query
        </SubmitButton>
      </form>

      <div className="grid gap-4">
        {queries.map((query) => (
          <QueryCard key={query.fileName} query={query} />
        ))}
      </div>
    </div>
  );
}
