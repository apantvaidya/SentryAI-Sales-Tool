"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { generateCompanyResearch, generatePersonalizedEmail, scorePersonRelevance } from "@/lib/ai/client";
import {
  addActivity,
  assignCampaign as storeAssignCampaign,
  bulkDeletePeople as storeBulkDeletePeople,
  cancelOutreachJob as storeCancelOutreachJob,
  createCampaign as storeCreateCampaign,
  createOutreachDraft,
  createOutreachJob,
  createOutreachResearch,
  createPerson as storeCreatePerson,
  deleteOutreachDraft as storeDeleteOutreachDraft,
  deletePerson as storeDeletePerson,
  getPerson,
  getPersonById,
  getOutreachJob,
  importPeopleFromCsv as storeImportPeopleFromCsv,
  markPersonFailedIfNoApiDraft,
  replaceResearchBrief,
  updateOutreachDraft as storeUpdateOutreachDraft,
  updateOutreachJobItem,
  updatePerson as storeUpdatePerson,
  updatePersonScore,
  upsertImportedLeadGenRun
} from "@/lib/data/store";
import { parsePeopleCsv } from "@/lib/csv";
import { extractDomain, findEmailWithHunter, parseName } from "@/lib/hunter/client";
import { enrichPersonFromLinkedIn } from "@/lib/leadgen/enrich";
import { importLeadGenArtifacts } from "@/lib/leadgen/import";
import { createQueryTemplate, deleteQueryTemplate, saveQueryTemplate } from "@/lib/leadgen/queryTemplates";
import { saveQueryTargeting } from "@/lib/leadgen/queryTargeting";
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
  const campaignId = value(formData, "campaignId");
  if (!firstName || !lastName) throw new Error("First and last name are required");
  if (!role) throw new Error("Role is required");
  if (!campaignId) throw new Error("Campaign is required");
  const person = await storeCreatePerson({
    campaignId,
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
  const campaignId = value(formData, "campaignId");
  await storeUpdatePerson(personId, {
    ...(campaignId ? { campaignId } : {}),
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

export async function createCampaign(formData: FormData) {
  const name = value(formData, "name");
  if (!name) throw new Error("Campaign name is required");
  await storeCreateCampaign(name);
  revalidatePath("/people");
}

export async function assignCampaign(formData: FormData) {
  const personIds = Array.from(
    new Set(formData.getAll("personIds").filter((item): item is string => typeof item === "string" && Boolean(item)))
  );
  const campaignId = value(formData, "campaignId");
  if (!campaignId) throw new Error("Campaign is required");
  if (personIds.length === 0) return;
  await storeAssignCampaign(personIds, campaignId);
  revalidatePath("/people");
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

export async function findEmailForPerson(personId: string) {
  const person = await getPerson(personId);
  if (!person) throw new Error("Person not found");
  if (!person.companyWebsite) throw new Error("No company website set — add one to enable email lookup");

  const domain = extractDomain(person.companyWebsite);
  if (!domain) throw new Error("Could not extract a domain from the company website");

  const { firstName, lastName } = parseName(person.name);
  if (!firstName || !lastName) throw new Error("Need both a first and last name to look up email");

  if (!process.env.HUNTER_API_KEY) throw new Error("HUNTER_API_KEY is not configured");

  const result = await findEmailWithHunter({ firstName, lastName, domain });
  if (!result) throw new Error("Hunter.io could not find an email for this person");

  await storeUpdatePerson(personId, {
    email: result.email,
    emailVerified: result.score >= 90,
  });
  await addActivity(
    personId,
    "email_found",
    `Email found via Hunter.io: ${result.email} (confidence: ${result.score}%)`
  );
  revalidatePath(`/people/${personId}`);
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
  const campaignId = value(formData, "campaignId");
  if (!artifactRunId) throw new Error("Artifact run is required");
  if (!campaignId) throw new Error("Campaign is required");
  const imported = await importLeadGenArtifacts(artifactRunId);
  const run = await upsertImportedLeadGenRun({ run: imported.run, campaignId, candidates: toUpsertCandidates(imported.candidates) });
  revalidatePath("/people");
  redirect(`/people?runId=${run.id}`);
}

export async function createLeadGenRun(formData: FormData) {
  const personName = value(formData, "seedPersonName");
  const companyName = value(formData, "seedCompanyName");
  const campaignId = value(formData, "campaignId");
  if (!personName || !companyName) throw new Error("Seed person name and company are required");
  if (!campaignId) throw new Error("Campaign is required");

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
      const run = await upsertImportedLeadGenRun({ run: imported.run, campaignId, candidates: toUpsertCandidates(imported.candidates) });
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
  const run = await upsertImportedLeadGenRun({ run: imported.run, campaignId, candidates: toUpsertCandidates(imported.candidates) });
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
    await markPersonFailedIfNoApiDraft(personId);
  }

  return research;
}

async function executePersonOutreach(personId: string) {
  const person = await getPerson(personId);
  if (!person) throw new Error("Person not found");
  try {
    const execution = await runWarmOutreachForPerson(person);
    const research = await persistOutreachExecution(personId, execution);
    revalidatePath(`/people/${personId}`);
    revalidatePath("/people");
    return research;
  } catch (error) {
    await markPersonFailedIfNoApiDraft(personId);
    revalidatePath(`/people/${personId}`);
    revalidatePath("/people");
    throw error;
  }
}

export async function runPersonOutreach(personId: string) {
  await executePersonOutreach(personId);
}

export async function importPeopleCsv(formData: FormData) {
  const file = formData.get("csvFile") as File | null;
  const campaignId = value(formData, "campaignId");
  const defaultCompany = value(formData, "defaultCompany");
  if (!file || file.size === 0) throw new Error("CSV file is required");
  if (!campaignId) throw new Error("Campaign is required");
  if (file.size > 10 * 1024 * 1024) throw new Error("CSV file must be under 10 MB");

  const text = await file.text();
  const rows = parsePeopleCsv(text);

  function col(row: Record<string, string>, ...keys: string[]): string | undefined {
    for (const k of keys) {
      const v = row[k]?.trim();
      if (v) return v;
    }
    return undefined;
  }

  const entries = rows
    .map((row) => {
      // Support split first/last name columns (e.g. LA water contacts CSV)
      const directName = col(row, "name", "poc identified", "full_name", "fullname", "full name");
      const firstName = col(row, "first name", "firstname", "first_name");
      const lastName = col(row, "last name", "lastname", "last_name");
      const combinedName = firstName && lastName ? `${firstName} ${lastName}` : (firstName || lastName);
      const name = directName || combinedName;

      // "Linkedln id" is a consistent typo across several source sheets
      const linkedinUrl = col(
        row,
        "linkedinurl", "linkedin_url", "linkedin url", "linkedin",
        "linkedln id", "linkedln_id", "linkedin id"
      );

      return {
        campaignId,
        name,
        companyName: col(row, "company", "company name", "company_name", "companyname", "organization", "agency") || defaultCompany,
        title: col(row, "title", "designation", "position", "role", "job_title", "job title"),
        email: col(row, "email", "mail id", "email_address", "email address", "customers email"),
        linkedinUrl,
        location: col(row, "location", "city"),
        notes: col(row, "notes", "note", "comments", "company info - notes"),
        source: col(row, "source") || "CSV import",
        companyWebsite: col(row, "companywebsite", "company_website", "company website", "website")
      };
    })
    .filter((e): e is typeof e & { name: string; companyName: string } =>
      Boolean(e.name && e.companyName)
    );

  if (entries.length === 0)
    throw new Error(
      "No valid rows found. CSV must have name and company columns, or set a default company name."
    );

  await storeImportPeopleFromCsv(entries);
  revalidatePath("/people");
}

async function runOutreachJobInBackground(jobId: string, personIds: string[]) {
  for (const personId of personIds) {
    const job = await getOutreachJob(jobId);
    if (job?.canceledAt) break;
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

export async function cancelEmailGenerationJob(jobId: string) {
  await storeCancelOutreachJob(jobId);
  revalidatePath("/people");
}

export async function runPeopleBatchOutreach(formData: FormData) {
  const personIds = Array.from(
    new Set(formData.getAll("candidateIds").filter((item): item is string => typeof item === "string" && Boolean(item)))
  );
  if (personIds.length === 0) return;
  if (personIds.length === 1) {
    try {
      await executePersonOutreach(personIds[0]);
    } catch {
      // Redirect to person page regardless — failed state is persisted via activity log
    }
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

export async function deleteSelectedPeople(personIds: string[]) {
  if (personIds.length === 0) return;
  await storeBulkDeletePeople(personIds);
  revalidatePath("/people");
}

export type EnrichResult = {
  enriched: number;
  skipped: number;
  failed: Array<{ id: string; name: string; reason: string }>;
};

export async function enrichSelectedPeople(personIds: string[]): Promise<EnrichResult> {
  const result: EnrichResult = { enriched: 0, skipped: 0, failed: [] };

  for (const personId of personIds) {
    const person = await getPerson(personId);
    if (!person) continue;

    if (person.title && person.location) {
      result.skipped++;
      continue;
    }

    if (!person.linkedinUrl) {
      result.failed.push({ id: personId, name: person.name, reason: "No LinkedIn URL" });
      continue;
    }

    const data = await enrichPersonFromLinkedIn(person);

    if (!data) {
      result.failed.push({ id: personId, name: person.name, reason: "Could not fetch profile" });
      continue;
    }

    const update: Partial<{ title: string; location: string }> = {};
    if (!person.title && data.title) update.title = data.title;
    if (!person.location && data.location) update.location = data.location;

    if (Object.keys(update).length === 0) {
      result.failed.push({ id: personId, name: person.name, reason: "No new info found" });
      continue;
    }

    await storeUpdatePerson(personId, update);
    result.enriched++;
  }

  revalidatePath("/people");
  return result;
}

export async function updateQueryTemplate(formData: FormData) {
  const originalFileName = value(formData, "originalFileName");
  const fileName = value(formData, "fileName");
  const content = value(formData, "content");
  if (!fileName) throw new Error("Query file name is required");
  if (!content) throw new Error("Query content is required");

  await saveQueryTemplate({ originalFileName, fileName, content });
  revalidatePath("/queries");
}

export async function addQueryTemplate(formData: FormData) {
  const fileName = value(formData, "fileName");
  const content = value(formData, "content");
  if (!fileName) throw new Error("Query file name is required");
  if (!content) throw new Error("Query content is required");

  await createQueryTemplate({ fileName, content });
  revalidatePath("/queries");
}

export async function removeQueryTemplate(formData: FormData) {
  const fileName = value(formData, "fileName");
  if (!fileName) throw new Error("Query file name is required");

  await deleteQueryTemplate(fileName);
  revalidatePath("/queries");
}

export async function updateQueryTargeting(formData: FormData) {
  const querySuffix = value(formData, "querySuffix");
  const userLocation = value(formData, "userLocation");
  if (!querySuffix) throw new Error("Query location text is required");
  if (!userLocation) throw new Error("Exa userLocation is required");

  await saveQueryTargeting({ querySuffix, userLocation });
  revalidatePath("/queries");
}
