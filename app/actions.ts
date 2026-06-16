"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { generateCompanyResearch, generatePersonalizedEmail, scorePersonRelevance } from "@/lib/ai/client";
import {
  addActivity,
  createOutreachDraft,
  createOutreachJob,
  createOutreachResearch,
  createPerson as storeCreatePerson,
  deleteOutreachDraft as storeDeleteOutreachDraft,
  deletePerson as storeDeletePerson,
  getPerson,
  getPersonById,
  replaceResearchBrief,
  updateOutreachDraft as storeUpdateOutreachDraft,
  updateOutreachJobItem,
  updatePerson as storeUpdatePerson,
  updatePersonScore,
  upsertImportedLeadGenRun
} from "@/lib/data/store";
import { importLeadGenArtifacts } from "@/lib/leadgen/import";
import { runLeadGeneration, runLeadGenerationExpansion } from "@/lib/leadgen/service";
import { evidenceSummaryText, runWarmOutreachForPerson, sourceUrls } from "@/lib/outreach/service";
import type { DraftTone, OutreachResearch, ValidationRecommendation } from "@/lib/data/types";
import type { ArtifactCandidate } from "@/lib/leadgen/import";

function value(formData: FormData, key: string) {
  const raw = formData.get(key);
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

export async function createPerson(formData: FormData) {
  const companyName = value(formData, "companyName");
  if (!companyName) throw new Error("Company name is required");
  const firstName = value(formData, "firstName");
  const lastName = value(formData, "lastName");
  const role = value(formData, "role");
  if (!firstName || !lastName) throw new Error("First and last name are required");
  if (!role) throw new Error("Role is required");
  const person = await storeCreatePerson({
    name: `${firstName} ${lastName}`,
    title: role,
    linkedinUrl: value(formData, "linkedinUrl"),
    source: "Manual",
    companyName
  });
  const brief = await generateCompanyResearch({ companyName });
  await replaceResearchBrief(person.id, brief);
  revalidatePath("/people");
  redirect(`/people/${person.id}`);
}

export async function updatePerson(personId: string, formData: FormData) {
  await storeUpdatePerson(personId, {
    name: value(formData, "name") || "",
    title: value(formData, "title") || "",
    email: value(formData, "email"),
    linkedinUrl: value(formData, "linkedinUrl"),
    source: value(formData, "source"),
    notes: value(formData, "notes"),
    emailVerified: formData.get("emailVerified") === "on",
    companyName: value(formData, "companyName") || "",
    companyWebsite: value(formData, "companyWebsite"),
    companyIndustry: value(formData, "companyIndustry"),
    companySize: value(formData, "companySize"),
    companySegment: value(formData, "companySegment"),
    companyNotes: value(formData, "companyNotes")
  });
  revalidatePath(`/people/${personId}`);
  revalidatePath("/people");
}

export async function deletePerson(personId: string) {
  await storeDeletePerson(personId);
  revalidatePath("/people");
  redirect("/people");
}

export async function generatePersonResearchBrief(personId: string) {
  const person = await getPerson(personId);
  if (!person) throw new Error("Person not found");
  const brief = await generateCompanyResearch({
    companyName: person.companyName,
    website: person.companyWebsite,
    industry: person.companyIndustry,
    notes: person.companyNotes,
    segment: person.companySegment
  });
  await replaceResearchBrief(personId, brief);
  revalidatePath(`/people/${personId}`);
}

export async function scorePerson(personId: string) {
  const detail = await getPersonById(personId);
  if (!detail) throw new Error("Person not found");
  const score = await scorePersonRelevance({
    person: detail.person,
    title: detail.person.title || "",
    personas: detail.personas
  });
  await updatePersonScore(personId, score);
  revalidatePath(`/people/${personId}`);
  revalidatePath("/people");
}

export async function generateOutreachDraft(personId: string, formData: FormData) {
  const detail = await getPersonById(personId);
  if (!detail) throw new Error("Person not found");
  const personaId = value(formData, "personaId");
  const tone = (value(formData, "tone") || "concise") as DraftTone;
  const persona =
    detail.personas.find((item) => item.id === personaId) ||
    detail.personas.find((item) => item.personaName === detail.person.bestPersonaMatch) ||
    detail.personas[0];
  const draft = await generatePersonalizedEmail({
    person: detail.person,
    persona,
    tone,
    notes: value(formData, "notes")
  });
  await createOutreachDraft(personId, {
    personaId: persona?.id,
    subject: draft.subject,
    body: draft.body,
    tone,
    personalizationNotes: draft.personalizationNotes,
    riskFlags: draft.riskFlags
  });
  revalidatePath(`/people/${personId}`);
}

export async function updateOutreachDraft(draftId: string, personId: string, formData: FormData) {
  await storeUpdateOutreachDraft(draftId, {
    subject: value(formData, "subject") || "",
    body: value(formData, "body") || "",
    tone: (value(formData, "tone") || "concise") as DraftTone
  });
  revalidatePath(`/people/${personId}`);
}

export async function approveOutreachDraft(draftId: string, personId: string) {
  await storeUpdateOutreachDraft(draftId, { status: "approved" });
  revalidatePath(`/people/${personId}`);
  revalidatePath("/people");
}

export async function deleteOutreachDraft(draftId: string, personId: string) {
  await storeDeleteOutreachDraft(draftId);
  revalidatePath(`/people/${personId}`);
}

function toUpsertCandidates(candidates: ArtifactCandidate[]) {
  return candidates
    .filter((candidate) => candidate.status !== "dropped")
    .map((candidate) => ({
      identityKey: candidate.identityKey,
      identityKeyType: candidate.identityKeyType,
      linkedinUrl: candidate.linkedinUrl,
      fullName: candidate.fullName,
      currentTitle: candidate.currentTitle,
      currentCompany: candidate.currentCompany,
      resolvedLocation: candidate.resolvedLocation,
      yearsAtCurrentRole: candidate.yearsAtCurrentRole,
      sourceQueryIds: candidate.sourceQueryIds,
      sourceQueryNames: candidate.sourceQueryNames,
      sourceBuckets: candidate.sourceBuckets,
      overlapCount: candidate.overlapCount,
      artifactRefs: candidate.artifactRefs,
      notes: candidate.status === "needs_review" ? "Flagged by the lead-gen filter for manual review." : undefined
    }));
}

export async function registerExistingLeadGenRun(formData: FormData) {
  const artifactRunId = value(formData, "artifactRunId");
  if (!artifactRunId) throw new Error("Artifact run is required");
  const imported = await importLeadGenArtifacts(artifactRunId);
  const run = await upsertImportedLeadGenRun({ run: imported.run, candidates: toUpsertCandidates(imported.candidates) });
  revalidatePath("/people");
  redirect(`/people?runId=${run.id}`);
}

export async function createLeadGenRun(formData: FormData) {
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
      const imported = await importLeadGenArtifacts(hopRunId);
      imported.run.command = execution.command;
      imported.run.exitCode = execution.exitCode;
      imported.run.stdoutSnippet = execution.stdoutSnippet;
      imported.run.stderrSnippet = execution.stderrSnippet;
      const run = await upsertImportedLeadGenRun({ run: imported.run, candidates: toUpsertCandidates(imported.candidates) });
      if (!firstRunId) firstRunId = run.id;
    }

    revalidatePath("/people");
    redirect(`/people?runId=${firstRunId}`);
  }

  const execution = await runLeadGeneration(seed);
  if (!execution.runId) {
    throw new Error(execution.errorMessage || execution.stderrSnippet || "Lead generation failed before returning a run id.");
  }
  const imported = await importLeadGenArtifacts(execution.runId);
  imported.run.command = execution.command;
  imported.run.exitCode = execution.exitCode;
  imported.run.stdoutSnippet = execution.stdoutSnippet;
  imported.run.stderrSnippet = execution.stderrSnippet;
  const run = await upsertImportedLeadGenRun({ run: imported.run, candidates: toUpsertCandidates(imported.candidates) });
  revalidatePath("/people");
  redirect(`/people?runId=${run.id}`);
}

async function persistOutreachExecution(personId: string, execution: Awaited<ReturnType<typeof runWarmOutreachForPerson>>) {
  const timestamp = new Date().toISOString();
  const output = execution.output;
  const recommendation = (output?.validation.recommendation || "human_review") as ValidationRecommendation;
  const researchInput: Omit<OutreachResearch, "id" | "createdAt" | "updatedAt"> = {
    personId,
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
    await createOutreachDraft(personId, {
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
  } else {
    await addActivity(personId, "outreach_failed", "Warm outreach pipeline failed before producing a draft.");
  }

  return research;
}

async function executePersonOutreach(personId: string) {
  const person = await getPerson(personId);
  if (!person) throw new Error("Person not found");
  const execution = await runWarmOutreachForPerson(person);
  const research = await persistOutreachExecution(personId, execution);
  revalidatePath(`/people/${personId}`);
  revalidatePath("/people");
  return research;
}

export async function runPersonOutreach(personId: string) {
  await executePersonOutreach(personId);
}

async function runOutreachJobInBackground(jobId: string, personIds: string[]) {
  for (const personId of personIds) {
    await updateOutreachJobItem(jobId, personId, "running");
    try {
      await executePersonOutreach(personId);
      await updateOutreachJobItem(jobId, personId, "completed");
    } catch (error) {
      await updateOutreachJobItem(jobId, personId, "failed", error instanceof Error ? error.message : "Unknown error");
    }
  }
  revalidatePath("/people");
}

export async function runPeopleBatchOutreach(formData: FormData) {
  const personIds = Array.from(
    new Set(formData.getAll("candidateIds").filter((item): item is string => typeof item === "string" && Boolean(item)))
  );
  if (personIds.length === 0) return;
  if (personIds.length > 50) throw new Error("Generate email from People is capped at 50 selected people at a time.");

  if (personIds.length === 1) {
    await executePersonOutreach(personIds[0]);
    revalidatePath("/people");
    redirect(`/people/${personIds[0]}`);
  }

  const people = await Promise.all(personIds.map((personId) => getPerson(personId)));
  const job = await createOutreachJob(
    people
      .filter((person): person is NonNullable<typeof person> => Boolean(person))
      .map((person) => ({ id: person.id, name: person.name }))
  );

  after(() => runOutreachJobInBackground(job.id, personIds));

  revalidatePath("/people");
  redirect(`/people?jobId=${job.id}`);
}
