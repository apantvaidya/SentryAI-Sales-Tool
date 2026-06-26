"use client";

import { useState } from "react";
import { Check, Clipboard, ExternalLink, FileDown, ShieldAlert, Trash2 } from "lucide-react";
import { approveOutreachDraft, deleteOutreachDraft, updateOutreachDraft } from "@/app/actions";
import type { OutreachDraft } from "@/lib/data/types";

export function DraftEditor({ drafts, personId }: { drafts: OutreachDraft[]; personId: string }) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function copyDraft(draft: OutreachDraft) {
    const channel = draft.channel || "email";
    const text = channel === "linkedin" ? draft.body : `Subject: ${draft.subject}\n\n${draft.body}`;
    await navigator.clipboard.writeText(text);
    setCopiedId(draft.id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  if (drafts.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
        <p className="font-semibold text-ink">No outreach drafts yet</p>
        <p className="mt-1 text-sm text-slate-500">Generate a draft from a persona, then review before copy or export.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      {drafts.map((draft) => {
        const channel = draft.channel || "email";
        const needsHumanReview = draft.validationRecommendation === "human_review" || draft.validationRecommendation === "reject";
        return (
          <article key={draft.id} className="surface p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-ink">{draft.subject}</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold capitalize text-slate-700">{channel}</span>
                {draft.validationRecommendation ? (
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold capitalize text-amber-700">
                    {draft.validationRecommendation.replace("_", " ")}
                  </span>
                ) : null}
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold capitalize text-slate-700">{draft.status}</span>
              </div>
            </div>
            {needsHumanReview ? (
              <div className="mb-4 flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
                <ShieldAlert size={18} className="mt-0.5 shrink-0" />
                This draft needs human review before approval because validation returned {draft.validationRecommendation?.replace("_", " ")}.
              </div>
            ) : null}
            {draft.evidenceSummarySnippet || draft.sourceUrls?.length ? (
              <div className="mb-4 rounded-md bg-slate-50 p-3 text-sm text-slate-700">
                {draft.evidenceSummarySnippet ? (
                  <>
                    <p className="font-bold text-ink">Evidence Summary</p>
                    <p className="mt-1 leading-6">{draft.evidenceSummarySnippet}</p>
                  </>
                ) : null}
                {draft.sourceUrls?.length ? (
                  <div className="mt-3 grid gap-1">
                    <p className="font-bold text-ink">Sources</p>
                    {draft.sourceUrls.map((url) => (
                      <a key={url} href={url} target="_blank" className="inline-flex items-center gap-2 break-all text-xs font-semibold text-sentry-700">
                        <ExternalLink size={13} />
                        {url}
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            <form action={updateOutreachDraft.bind(null, draft.id, personId)} className="grid gap-3">
              <div className="grid gap-2 md:grid-cols-[1fr_180px]">
                <input className="field" name="subject" defaultValue={draft.subject} aria-label="Subject" />
                <select className="field" name="tone" defaultValue={draft.tone} aria-label="Tone">
                  <option value="concise">concise</option>
                  <option value="executive">executive</option>
                  <option value="technical">technical</option>
                  <option value="warm">warm</option>
                </select>
              </div>
              <textarea className="field min-h-56" name="body" defaultValue={draft.body} aria-label="Body" />
              <div className="grid gap-3 rounded-md bg-slate-50 p-3 text-sm text-slate-700">
                <p className="font-bold text-ink">Manual review notes</p>
                <ul className="list-disc space-y-1 pl-5">
                  {draft.personalizationNotes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                  {draft.riskFlags.map((flag) => (
                    <li key={flag}>{flag}</li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="button-secondary" type="submit">
                  Save Draft
                </button>
                <button className="button-secondary" type="button" onClick={() => copyDraft(draft)} disabled={draft.status !== "approved"}>
                  {copiedId === draft.id ? <Check size={16} /> : <Clipboard size={16} />}
                  {channel === "linkedin" ? "Copy LinkedIn Message" : "Copy Email"}
                </button>
                <button className="button-primary" formAction={approveOutreachDraft.bind(null, draft.id, personId)}>
                  Approve Draft
                </button>
                <button
                  className="button-secondary border-red-200 text-red-700 hover:border-red-300 hover:bg-red-50"
                  formAction={deleteOutreachDraft.bind(null, draft.id, personId)}
                  onClick={(event) => {
                    if (!window.confirm("Delete this draft? This cannot be undone.")) {
                      event.preventDefault();
                    }
                  }}
                >
                  <Trash2 size={16} />
                  Delete
                </button>
                <a className="button-secondary" href={`/people/${personId}/export`}>
                  <FileDown size={16} />
                  Export CSV
                </a>
              </div>
              {draft.status !== "approved" ? (
                <p className="text-xs text-amber-700">Copy is disabled until the draft is approved.</p>
              ) : null}
            </form>
          </article>
        );
      })}
    </div>
  );
}
