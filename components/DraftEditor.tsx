"use client";

import { useState } from "react";
import { Check, Clipboard, FileDown } from "lucide-react";
import { approveOutreachDraft, updateOutreachDraft } from "@/app/actions";
import type { Contact, OutreachDraft } from "@/lib/data/types";

export function DraftEditor({
  drafts,
  contacts,
  prospectId
}: {
  drafts: OutreachDraft[];
  contacts: Contact[];
  prospectId: string;
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function copyDraft(draft: OutreachDraft) {
    await navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`);
    setCopiedId(draft.id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  if (drafts.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
        <p className="font-semibold text-ink">No outreach drafts yet</p>
        <p className="mt-1 text-sm text-slate-500">Generate a draft from a contact and persona, then review before copy or export.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      {drafts.map((draft) => {
        const contact = contacts.find((item) => item.id === draft.contactId);
        return (
          <article key={draft.id} className="surface p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{contact?.name || "Persona draft"}</p>
                <h3 className="text-lg font-bold text-ink">{draft.subject}</h3>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold capitalize text-slate-700">{draft.status}</span>
            </div>
            <form action={updateOutreachDraft.bind(null, draft.id, prospectId)} className="grid gap-3">
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
                  Copy Email
                </button>
                <button className="button-primary" formAction={approveOutreachDraft.bind(null, draft.id, prospectId)}>
                  Approve Draft
                </button>
                <a className="button-secondary" href={`/prospects/${prospectId}/export`}>
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
