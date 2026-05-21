"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { generateCompanyResearch, generatePersonalizedEmail, scoreContactRelevance } from "@/lib/ai/client";
import {
  createContact as storeCreateContact,
  createOutreachDraft,
  createProspect as storeCreateProspect,
  deleteProspect as storeDeleteProspect,
  getProspectById,
  replaceResearchBrief,
  updateContact as storeUpdateContact,
  updateContactScore,
  updateOutreachDraft as storeUpdateOutreachDraft,
  updateProspect as storeUpdateProspect
} from "@/lib/data/store";
import type { DraftTone } from "@/lib/data/types";

function value(formData: FormData, key: string) {
  const raw = formData.get(key);
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

export async function createProspect(formData: FormData) {
  const companyName = value(formData, "companyName");
  if (!companyName) throw new Error("Company name is required");
  const prospect = await storeCreateProspect({
    companyName,
    website: value(formData, "website"),
    industry: value(formData, "industry"),
    companySize: value(formData, "companySize"),
    segment: value(formData, "segment"),
    notes: value(formData, "notes")
  });
  const brief = await generateCompanyResearch(prospect);
  await replaceResearchBrief(prospect.id, brief);
  revalidatePath("/");
  redirect(`/prospects/${prospect.id}`);
}

export async function updateProspect(prospectId: string, formData: FormData) {
  await storeUpdateProspect(prospectId, {
    companyName: value(formData, "companyName") || "",
    website: value(formData, "website"),
    industry: value(formData, "industry"),
    companySize: value(formData, "companySize"),
    segment: value(formData, "segment"),
    notes: value(formData, "notes")
  });
  revalidatePath(`/prospects/${prospectId}`);
}

export async function deleteProspect(prospectId: string) {
  await storeDeleteProspect(prospectId);
  revalidatePath("/");
  redirect("/");
}

export async function generateResearchBrief(prospectId: string) {
  const workspace = await getProspectById(prospectId);
  if (!workspace) throw new Error("Prospect not found");
  const brief = await generateCompanyResearch(workspace.prospect);
  await replaceResearchBrief(prospectId, brief);
  revalidatePath(`/prospects/${prospectId}`);
}

export async function createContact(prospectId: string, formData: FormData) {
  await storeCreateContact(prospectId, {
    name: value(formData, "name") || "",
    title: value(formData, "title") || "",
    email: value(formData, "email"),
    linkedinUrl: value(formData, "linkedinUrl"),
    source: value(formData, "source") || "Manual",
    relevanceReason: value(formData, "relevanceReason"),
    notes: value(formData, "notes")
  });
  revalidatePath(`/prospects/${prospectId}`);
  revalidatePath(`/prospects/${prospectId}/contacts`);
}

export async function updateContact(contactId: string, prospectId: string, formData: FormData) {
  await storeUpdateContact(contactId, {
    name: value(formData, "name") || "",
    title: value(formData, "title") || "",
    email: value(formData, "email"),
    linkedinUrl: value(formData, "linkedinUrl"),
    source: value(formData, "source"),
    notes: value(formData, "notes"),
    emailVerified: formData.get("emailVerified") === "on"
  });
  revalidatePath(`/prospects/${prospectId}/contacts`);
}

export async function scoreContact(contactId: string, prospectId: string) {
  const workspace = await getProspectById(prospectId);
  if (!workspace) throw new Error("Prospect not found");
  const contact = workspace.contacts.find((item) => item.id === contactId);
  if (!contact) throw new Error("Contact not found");
  const score = await scoreContactRelevance({
    prospect: workspace.prospect,
    contactTitle: contact.title,
    personas: workspace.personas
  });
  await updateContactScore(contactId, score);
  revalidatePath(`/prospects/${prospectId}`);
  revalidatePath(`/prospects/${prospectId}/contacts`);
}

export async function generateOutreachDraft(prospectId: string, formData: FormData) {
  const workspace = await getProspectById(prospectId);
  if (!workspace) throw new Error("Prospect not found");
  const contactId = value(formData, "contactId");
  const personaId = value(formData, "personaId");
  const tone = (value(formData, "tone") || "concise") as DraftTone;
  const contact = workspace.contacts.find((item) => item.id === contactId);
  const persona =
    workspace.personas.find((item) => item.id === personaId) ||
    workspace.personas.find((item) => item.personaName === contact?.bestPersonaMatch) ||
    workspace.personas[0];
  const draft = await generatePersonalizedEmail({
    workspace,
    contact,
    persona,
    tone,
    notes: value(formData, "notes")
  });
  await createOutreachDraft(prospectId, {
    contactId,
    personaId: persona?.id,
    subject: draft.subject,
    body: draft.body,
    tone,
    personalizationNotes: draft.personalizationNotes,
    riskFlags: draft.riskFlags
  });
  revalidatePath(`/prospects/${prospectId}`);
  revalidatePath(`/prospects/${prospectId}/drafts`);
}

export async function updateOutreachDraft(draftId: string, prospectId: string, formData: FormData) {
  await storeUpdateOutreachDraft(draftId, {
    subject: value(formData, "subject") || "",
    body: value(formData, "body") || "",
    tone: (value(formData, "tone") || "concise") as DraftTone
  });
  revalidatePath(`/prospects/${prospectId}/drafts`);
}

export async function approveOutreachDraft(draftId: string, prospectId: string) {
  await storeUpdateOutreachDraft(draftId, { status: "approved" });
  revalidatePath(`/prospects/${prospectId}`);
  revalidatePath(`/prospects/${prospectId}/drafts`);
}
