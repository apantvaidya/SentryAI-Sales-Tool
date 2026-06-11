"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { generateCompanyResearch, generatePersonalizedEmail, scoreContactRelevance } from "@/lib/ai/client";
import {
  createContact as storeCreateContact,
  createOutreachDraft,
  createOutreachResearch,
  createProspect as storeCreateProspect,
  deleteOutreachDraft as storeDeleteOutreachDraft,
  deleteProspect as storeDeleteProspect,
  getAllCandidates,
  getContactById,
  getLeadCandidateById,
  getProspectById,
  importLeadCandidateAsContact as storeImportLeadCandidateAsContact,
  replaceResearchBrief,
  updateContact as storeUpdateContact,
  updateContactScore,
  updateOutreachDraft as storeUpdateOutreachDraft,
  updateProspect as storeUpdateProspect,
  upsertImportedLeadGenRun
} from "@/lib/data/store";
import { importLeadGenArtifacts } from "@/lib/leadgen/import";
import { runLeadGeneration, runLeadGenerationExpansion } from "@/lib/leadgen/service";
import { evidenceSummaryText, runWarmOutreachForContact, sourceUrls } from "@/lib/outreach/service";
import type { DraftTone, OutreachResearch, ValidationRecommendation } from "@/lib/data/types";

function value(formData: FormData, key: string) {
  const raw = formData.get(key);
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

export async function createProspect(formData: FormData) {
  const companyName = value(formData, "companyName");
  if (!companyName) throw new Error("Company name is required");
  const firstName = value(formData, "firstName");
  const lastName = value(formData, "lastName");
  const role = value(formData, "role");
  if (!firstName || !lastName) throw new Error("First and last name are required");
  if (!role) throw new Error("Role is required");
  const prospect = await storeCreateProspect({ companyName });
  await storeCreateContact(prospect.id, {
    name: `${firstName} ${lastName}`,
    title: role,
    linkedinUrl: value(formData, "linkedinUrl"),
    source: "Manual"
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

export async function deleteOutreachDraft(draftId: string, prospectId: string) {
  await storeDeleteOutreachDraft(draftId);
  revalidatePath(`/prospects/${prospectId}`);
  revalidatePath(`/prospects/${prospectId}/drafts`);
}

export async function registerExistingLeadGenRun(prospectId: string, formData: FormData) {
  const artifactRunId = value(formData, "artifactRunId");
  if (!artifactRunId) throw new Error("Artifact run is required");
  const imported = await importLeadGenArtifacts(prospectId, artifactRunId);
  const run = await upsertImportedLeadGenRun(imported);
  revalidatePath(`/prospects/${prospectId}`);
  revalidatePath(`/prospects/${prospectId}/candidates`);
  redirect(`/prospects/${prospectId}/candidates?runId=${run.id}`);
}

export async function createLeadGenRun(prospectId: string, formData: FormData) {
  const personName = value(formData, "seedPersonName");
  const companyName = value(formData, "seedCompanyName");
  if (!personName || !companyName) throw new Error("Seed person name and company are required");

  const seed = {
    person_name: personName,
    role: value(formData, "seedRole"),
    company_name: companyName,
    linkedin_url: value(formData, "seedLinkedinUrl")
  };

  const recursive = value(formData, "recursiveExpansion") === "on";

  if (recursive) {
    const targetTotal = Number.parseInt(value(formData, "targetTotal") || "", 10);
    if (!Number.isFinite(targetTotal) || targetTotal < 1) {
      throw new Error("Target total leads must be a positive number for recursive expansion.");
    }
    const maxHopsRaw = Number.parseInt(value(formData, "maxHops") || "", 10);
    const maxHops = Number.isFinite(maxHopsRaw) && maxHopsRaw > 0 ? maxHopsRaw : undefined;

    const execution = await runLeadGenerationExpansion(seed, { total: targetTotal, maxHops });
    if (execution.hopRunIds.length === 0) {
      throw new Error(
        execution.errorMessage || execution.stderrSnippet || "Recursive expansion failed before producing any hops."
      );
    }

    let firstRunId: string | undefined;
    for (const hopRunId of execution.hopRunIds) {
      const imported = await importLeadGenArtifacts(prospectId, hopRunId);
      imported.run.command = execution.command;
      imported.run.exitCode = execution.exitCode;
      imported.run.stdoutSnippet = execution.stdoutSnippet;
      imported.run.stderrSnippet = execution.stderrSnippet;
      const run = await upsertImportedLeadGenRun(imported);
      if (!firstRunId) firstRunId = run.id;
    }

    revalidatePath(`/prospects/${prospectId}`);
    revalidatePath(`/prospects/${prospectId}/candidates`);
    redirect(`/prospects/${prospectId}/candidates?runId=${firstRunId}`);
  }

  const execution = await runLeadGeneration(seed);
  if (!execution.runId) {
    throw new Error(execution.errorMessage || execution.stderrSnippet || "Lead generation failed before returning a run id.");
  }
  const imported = await importLeadGenArtifacts(prospectId, execution.runId);
  imported.run.command = execution.command;
  imported.run.exitCode = execution.exitCode;
  imported.run.stdoutSnippet = execution.stdoutSnippet;
  imported.run.stderrSnippet = execution.stderrSnippet;
  const run = await upsertImportedLeadGenRun(imported);
  revalidatePath(`/prospects/${prospectId}`);
  revalidatePath(`/prospects/${prospectId}/candidates`);
  redirect(`/prospects/${prospectId}/candidates?runId=${run.id}`);
}

export async function importLeadCandidateAsContact(prospectId: string, candidateId: string) {
  await storeImportLeadCandidateAsContact(prospectId, candidateId);
  revalidatePath(`/prospects/${prospectId}`);
  revalidatePath(`/prospects/${prospectId}/contacts`);
  revalidatePath(`/prospects/${prospectId}/candidates`);
}

export async function importSelectedLeadCandidates(prospectId: string, formData: FormData) {
  const candidateIds = formData.getAll("candidateIds").filter((item): item is string => typeof item === "string" && Boolean(item));
  for (const candidateId of candidateIds) {
    await storeImportLeadCandidateAsContact(prospectId, candidateId);
  }
  revalidatePath(`/prospects/${prospectId}`);
  revalidatePath(`/prospects/${prospectId}/contacts`);
  revalidatePath(`/prospects/${prospectId}/candidates`);
}

async function persistOutreachExecution(
  prospectId: string,
  contactId: string,
  candidateId: string | undefined,
  execution: Awaited<ReturnType<typeof runWarmOutreachForContact>>
) {
  const timestamp = new Date().toISOString();
  const output = execution.output;
  const recommendation = (output?.validation.recommendation || "human_review") as ValidationRecommendation;
  const researchInput: Omit<OutreachResearch, "id" | "createdAt" | "updatedAt"> = {
    prospectId,
    contactId,
    candidateId,
    linkedinUrl: output?.lead.linkedin || undefined,
    company: output?.lead.company || "Unknown company",
    location: output?.lead.location || undefined,
    role: output?.lead.role || undefined,
    personaType: output?.persona.persona_type,
    status: output ? "completed" : "failed",
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    pipelineVersion: "warm-outreach-v1",
    querySet: output?.queries || {},
    searchResults: output?.search_results || [],
    evidenceSummary: output ? evidenceSummaryText(output) : "Warm outreach pipeline failed before producing evidence.",
    validation: output?.validation || {},
    sourceUrls: output ? sourceUrls(output) : [],
    validationRecommendation: recommendation,
    startedAt: timestamp,
    completedAt: timestamp,
    errorMessage: execution.errorMessage,
    command: execution.command,
    exitCode: execution.exitCode,
    stdoutSnippet: execution.stdoutSnippet,
    stderrSnippet: execution.stderrSnippet
  };
  const research = await createOutreachResearch(researchInput);

  if (output) {
    await createOutreachDraft(prospectId, {
      contactId,
      candidateId,
      outreachResearchId: research.id,
      subject: output.email.subject,
      body: output.email.body,
      tone: "warm",
      personalizationNotes: [
        `Persona: ${output.persona.persona_type || "unknown"}`,
        `Validation: ${recommendation}`,
        `Evidence sources: ${research.sourceUrls.length}`
      ],
      riskFlags: output.validation.notes || output.evidence_summary.unsafe_claims_to_avoid || [],
      sourceUrls: research.sourceUrls,
      validationRecommendation: recommendation,
      evidenceSummarySnippet: research.evidenceSummary.slice(0, 500)
    });
  }

  return research;
}

export async function runCandidateOutreach(prospectId: string, candidateId: string) {
  let candidate = await getLeadCandidateById(prospectId, candidateId);
  if (!candidate) throw new Error("Lead candidate not found");
  const contactId = candidate.importedContactId || (await storeImportLeadCandidateAsContact(prospectId, candidateId));
  const contact = await getContactById(prospectId, contactId);
  if (!contact) throw new Error("Contact not found");
  candidate = await getLeadCandidateById(prospectId, candidateId);
  const workspace = await getProspectById(prospectId);
  if (!workspace) throw new Error("Prospect not found");
  const execution = await runWarmOutreachForContact(workspace, contact, candidate || undefined);
  await persistOutreachExecution(prospectId, contactId, candidateId, execution);
  revalidatePath(`/prospects/${prospectId}`);
  revalidatePath(`/prospects/${prospectId}/candidates`);
  revalidatePath(`/prospects/${prospectId}/crime-research`);
  revalidatePath(`/prospects/${prospectId}/drafts`);
}

export async function runContactOutreach(prospectId: string, contactId: string) {
  const workspace = await getProspectById(prospectId);
  if (!workspace) throw new Error("Prospect not found");
  const contact = workspace.contacts.find((item) => item.id === contactId);
  if (!contact) throw new Error("Contact not found");
  const candidate = workspace.leadCandidates.find((item) => item.importedContactId === contactId);
  const execution = await runWarmOutreachForContact(workspace, contact, candidate);
  await persistOutreachExecution(prospectId, contactId, candidate?.id, execution);
  revalidatePath(`/prospects/${prospectId}`);
  revalidatePath(`/prospects/${prospectId}/crime-research`);
  revalidatePath(`/prospects/${prospectId}/drafts`);
}

export async function runBatchCandidateOutreach(prospectId: string, formData: FormData) {
  const candidateIds = formData.getAll("candidateIds").filter((item): item is string => typeof item === "string" && Boolean(item));
  if (candidateIds.length > 10) throw new Error("Batch outreach is capped at 10 selected candidates.");
  for (const candidateId of candidateIds) {
    await runCandidateOutreach(prospectId, candidateId);
  }
}

export async function runPeopleBatchCandidateOutreach(formData: FormData) {
  const candidateIds = Array.from(
    new Set(formData.getAll("candidateIds").filter((item): item is string => typeof item === "string" && Boolean(item)))
  );
  if (candidateIds.length === 0) return;
  if (candidateIds.length > 1) throw new Error("Generate email from People is limited to one selected person at a time.");

  const candidates = await getAllCandidates();
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const selectedCandidates = candidateIds.map((candidateId) => {
    const candidate = candidateById.get(candidateId);
    if (!candidate) throw new Error(`Lead candidate not found: ${candidateId}`);
    return candidate;
  });

  for (const candidate of selectedCandidates) {
    await runCandidateOutreach(candidate.prospectId, candidate.id);
  }

  revalidatePath("/people");
  redirect(`/prospects/${selectedCandidates[0].prospectId}/drafts`);
}
