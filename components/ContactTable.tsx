"use client";

import { useState } from "react";
import { CheckCircle2, Pencil, ShieldAlert } from "lucide-react";
import type { Contact } from "@/lib/data/types";
import { runContactOutreach, scoreContact, updateContact } from "@/app/actions";

export function ContactTable({ contacts, prospectId }: { contacts: Contact[]; prospectId: string }) {
  const [editing, setEditing] = useState<string | null>(null);
  if (contacts.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
        <p className="font-semibold text-ink">No contacts yet</p>
        <p className="mt-1 text-sm text-slate-500">Add decision-makers manually, then score relevance before drafting.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[880px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Contact</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Score</th>
              <th className="px-4 py-3">Relevance</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {contacts.map((contact) => (
              <tr key={contact.id}>
                {editing === contact.id ? (
                  <td colSpan={5} className="px-4 py-4">
                    <form action={updateContact.bind(null, contact.id, prospectId)} className="grid gap-3 md:grid-cols-2">
                      <input className="field" name="name" defaultValue={contact.name} placeholder="Name" />
                      <input className="field" name="title" defaultValue={contact.title} placeholder="Title" />
                      <input className="field" name="email" defaultValue={contact.email} placeholder="Email" />
                      <input className="field" name="linkedinUrl" defaultValue={contact.linkedinUrl} placeholder="LinkedIn URL" />
                      <input className="field" name="source" defaultValue={contact.source} placeholder="Source" />
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input name="emailVerified" type="checkbox" defaultChecked={contact.emailVerified} />
                        Email manually verified
                      </label>
                      <textarea className="field md:col-span-2" name="notes" defaultValue={contact.notes} placeholder="Notes" />
                      <div className="flex gap-2 md:col-span-2">
                        <button className="button-primary" type="submit" onClick={() => setEditing(null)}>
                          Save
                        </button>
                        <button className="button-secondary" type="button" onClick={() => setEditing(null)}>
                          Cancel
                        </button>
                      </div>
                    </form>
                  </td>
                ) : (
                  <>
                    <td className="px-4 py-4">
                      <p className="font-semibold text-ink">{contact.name || "Unnamed contact"}</p>
                      <p className="text-slate-500">{contact.title}</p>
                      {contact.bestPersonaMatch ? <p className="mt-1 text-xs text-sentry-700">{contact.bestPersonaMatch}</p> : null}
                    </td>
                    <td className="px-4 py-4">
                      <p>{contact.email || "No email"}</p>
                      <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                        {contact.emailVerified ? <CheckCircle2 size={14} className="text-sentry-700" /> : <ShieldAlert size={14} className="text-amber-600" />}
                        {contact.emailVerified ? "Verified manually" : "Unverified"}
                      </p>
                    </td>
                    <td className="px-4 py-4 font-bold text-ink">{contact.confidenceScore}/100</td>
                    <td className="px-4 py-4 text-slate-600">{contact.relevanceReason || "Score this contact to generate a persona angle."}</td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-2">
                        <button className="button-secondary px-3" type="button" onClick={() => setEditing(contact.id)} title="Edit">
                          <Pencil size={16} />
                        </button>
                        <form action={scoreContact.bind(null, contact.id, prospectId)}>
                          <button className="button-secondary" type="submit">
                            Score Contact
                          </button>
                        </form>
                        <form action={runContactOutreach.bind(null, prospectId, contact.id)}>
                          <button className="button-secondary" type="submit">
                            Run Outreach
                          </button>
                        </form>
                      </div>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
