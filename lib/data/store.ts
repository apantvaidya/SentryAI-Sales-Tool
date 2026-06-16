import { promises as fs } from "fs";
import path from "path";
import type {
  Activity,
  BuyerPersona,
  CandidateIdentityKeyType,
  Database,
  DraftTone,
  LeadGenRun,
  OutreachDraft,
  OutreachJob,
  OutreachJobItemStatus,
  OutreachResearch,
  Person,
  PersonDetail,
  PersonStatus
} from "./types";

const dataDir = path.join(process.cwd(), "data");
const dbPath = path.join(dataDir, "db.json");

const emptyDb: Database = {
  people: [],
  personas: [],
  drafts: [],
  activities: [],
  leadGenRuns: [],
  outreachResearch: [],
  outreachJobs: []
};

async function ensureDb() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    await fs.access(dbPath);
  } catch {
    await fs.writeFile(dbPath, JSON.stringify(emptyDb, null, 2));
  }
}

async function readDb(): Promise<Database> {
  await ensureDb();
  const raw = await fs.readFile(dbPath, "utf8");
  return { ...emptyDb, ...JSON.parse(raw) };
}

async function writeDb(db: Database) {
  await ensureDb();
  await fs.writeFile(dbPath, JSON.stringify(db, null, 2));
}

function now() {
  return new Date().toISOString();
}

function id() {
  return crypto.randomUUID();
}

function sortUpdated(a: { updatedAt: string }, b: { updatedAt: string }) {
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

export async function getPersons() {
  const db = await readDb();
  return db.people.slice().sort(sortUpdated);
}

export async function getPerson(personId: string) {
  const db = await readDb();
  return db.people.find((item) => item.id === personId) || null;
}

export async function getPersonById(personId: string): Promise<PersonDetail | null> {
  const db = await readDb();
  const person = db.people.find((item) => item.id === personId);
  if (!person) return null;
  return {
    person,
    personas: db.personas.filter((item) => item.personId === personId),
    drafts: db.drafts.filter((item) => item.personId === personId),
    outreachResearch: db.outreachResearch.filter((item) => item.personId === personId),
    activities: db.activities
      .filter((item) => item.personId === personId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  };
}

export async function createPerson(input: {
  name: string;
  title?: string;
  email?: string;
  linkedinUrl?: string;
  source?: string;
  notes?: string;
  companyName: string;
  companyWebsite?: string;
  companyIndustry?: string;
  companySize?: string;
  companySegment?: string;
  companyNotes?: string;
}) {
  const db = await readDb();
  const timestamp = now();
  const person: Person = {
    id: id(),
    status: "new",
    name: input.name,
    title: input.title,
    email: input.email,
    emailVerified: false,
    linkedinUrl: input.linkedinUrl,
    source: input.source,
    notes: input.notes,
    confidenceScore: 50,
    companyName: input.companyName,
    companyWebsite: input.companyWebsite,
    companyIndustry: input.companyIndustry,
    companySize: input.companySize,
    companySegment: input.companySegment,
    companyNotes: input.companyNotes,
    companyPainPoints: [],
    companyFitScore: 0,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  db.people.push(person);
  db.activities.push({
    id: id(),
    personId: person.id,
    type: "created",
    message: `Added ${person.name} at ${person.companyName}.`,
    createdAt: timestamp
  });
  await writeDb(db);
  return person;
}

export async function updatePerson(personId: string, input: Partial<Omit<Person, "id" | "createdAt" | "updatedAt">>) {
  const db = await readDb();
  const index = db.people.findIndex((item) => item.id === personId);
  if (index === -1) throw new Error("Person not found");
  db.people[index] = { ...db.people[index], ...input, updatedAt: now() };
  await writeDb(db);
  return db.people[index];
}

export async function deletePerson(personId: string) {
  const db = await readDb();
  db.people = db.people.filter((item) => item.id !== personId);
  db.personas = db.personas.filter((item) => item.personId !== personId);
  db.drafts = db.drafts.filter((item) => item.personId !== personId);
  db.activities = db.activities.filter((item) => item.personId !== personId);
  db.outreachResearch = db.outreachResearch.filter((item) => item.personId !== personId);
  await writeDb(db);
}

export async function replaceResearchBrief(
  personId: string,
  brief: {
    summary: string;
    painPoints: string[];
    securityRelevance: string;
    smartSentryFitScore: number;
    fitRationale: string;
    recommendedPersonas: Array<Omit<BuyerPersona, "id" | "personId">>;
  }
) {
  const db = await readDb();
  const person = db.people.find((item) => item.id === personId);
  if (!person) throw new Error("Person not found");
  Object.assign(person, {
    companySummary: brief.summary,
    companyPainPoints: brief.painPoints,
    companySecurityRelevance: brief.securityRelevance,
    companyFitScore: brief.smartSentryFitScore,
    companyFitRationale: brief.fitRationale,
    updatedAt: now()
  });
  db.personas = db.personas.filter((item) => item.personId !== personId);
  db.personas.push(
    ...brief.recommendedPersonas.map((persona) => ({
      ...persona,
      id: id(),
      personId
    }))
  );
  db.activities.push({
    id: id(),
    personId,
    type: "research_generated",
    message: "Generated company intelligence, fit score, and buyer personas.",
    createdAt: now()
  });
  await writeDb(db);
}

export async function updatePersonScore(
  personId: string,
  score: { confidenceScore: number; relevanceReason: string; bestPersonaMatch?: string }
) {
  const db = await readDb();
  const person = db.people.find((item) => item.id === personId);
  if (!person) throw new Error("Person not found");
  Object.assign(person, { ...score, updatedAt: now() });
  db.activities.push({
    id: id(),
    personId,
    type: "person_scored",
    message: `Scored ${person.name} at ${score.confidenceScore}/100 for Smart Sentry relevance.`,
    createdAt: now()
  });
  await writeDb(db);
}

export async function createOutreachDraft(
  personId: string,
  input: {
    personaId?: string;
    outreachResearchId?: string;
    subject: string;
    body: string;
    tone: DraftTone;
    personalizationNotes: string[];
    riskFlags: string[];
    sourceUrls?: string[];
    validationRecommendation?: OutreachDraft["validationRecommendation"];
    evidenceSummarySnippet?: string;
  }
) {
  const db = await readDb();
  const timestamp = now();
  const existingDraft = db.drafts
    .filter(
      (item) =>
        item.personId === personId &&
        item.status !== "approved" &&
        (!input.outreachResearchId || item.outreachResearchId === input.outreachResearchId)
    )
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];

  if (existingDraft) {
    Object.assign(existingDraft, {
      ...input,
      status: "draft" as const,
      updatedAt: timestamp
    });
    db.activities.push({
      id: id(),
      personId,
      type: "draft_updated",
      message: "Updated the existing outreach draft for this person.",
      createdAt: timestamp
    });
    await writeDb(db);
    return existingDraft;
  }

  const draft: OutreachDraft = {
    id: id(),
    personId,
    personaId: input.personaId,
    outreachResearchId: input.outreachResearchId,
    subject: input.subject,
    body: input.body,
    tone: input.tone,
    status: "draft",
    personalizationNotes: input.personalizationNotes,
    riskFlags: input.riskFlags,
    sourceUrls: input.sourceUrls,
    validationRecommendation: input.validationRecommendation,
    evidenceSummarySnippet: input.evidenceSummarySnippet,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  db.drafts.push(draft);
  const person = db.people.find((item) => item.id === personId);
  if (person) {
    person.status = "drafting" satisfies PersonStatus;
    person.updatedAt = timestamp;
  }
  db.activities.push({
    id: id(),
    personId,
    type: "draft_created",
    message: "Generated a personalized outreach draft for manual review.",
    createdAt: timestamp
  });
  await writeDb(db);
  return draft;
}

export async function deleteOutreachDraft(draftId: string) {
  const db = await readDb();
  const draft = db.drafts.find((item) => item.id === draftId);
  if (!draft) throw new Error("Draft not found");
  db.drafts = db.drafts.filter((item) => item.id !== draftId);
  db.activities.push({
    id: id(),
    personId: draft.personId,
    type: "draft_deleted",
    message: "Deleted an outreach draft.",
    createdAt: now()
  });
  await writeDb(db);
}

export async function updateOutreachDraft(
  draftId: string,
  input: Partial<Pick<OutreachDraft, "subject" | "body" | "tone" | "status" | "personalizationNotes">>
) {
  const db = await readDb();
  const draft = db.drafts.find((item) => item.id === draftId);
  if (!draft) throw new Error("Draft not found");
  Object.assign(draft, { ...input, updatedAt: now() });
  if (input.status === "approved") {
    const person = db.people.find((item) => item.id === draft.personId);
    if (person) {
      person.status = "approved" satisfies PersonStatus;
      person.updatedAt = now();
    }
    db.activities.push({
      id: id(),
      personId: draft.personId,
      type: "draft_approved",
      message: "Approved outreach draft after manual review.",
      createdAt: now()
    });
  }
  await writeDb(db);
  return draft;
}

export async function addActivity(personId: string, type: string, message: string): Promise<Activity> {
  const db = await readDb();
  const activity = { id: id(), personId, type, message, createdAt: now() };
  db.activities.push(activity);
  await writeDb(db);
  return activity;
}

export async function getLeadGenRuns() {
  const db = await readDb();
  return db.leadGenRuns.slice().sort(sortUpdated);
}

export async function getLeadGenRun(runId: string) {
  const db = await readDb();
  return db.leadGenRuns.find((item) => item.id === runId) || null;
}

export async function getPeopleForLeadGenRun(leadGenRunId: string) {
  const db = await readDb();
  return db.people.filter((item) => item.leadGenRunId === leadGenRunId);
}

export async function upsertImportedLeadGenRun(input: {
  run: Omit<LeadGenRun, "id" | "createdAt" | "updatedAt">;
  candidates: Array<{
    identityKey: string;
    identityKeyType: CandidateIdentityKeyType;
    linkedinUrl?: string;
    fullName: string;
    currentTitle?: string;
    currentCompany?: string;
    resolvedLocation?: string;
    yearsAtCurrentRole?: number;
    sourceQueryIds: string[];
    sourceQueryNames?: string[];
    sourceBuckets?: string[];
    overlapCount: number;
    artifactRefs?: Person["artifactRefs"];
    notes?: string;
  }>;
}) {
  const db = await readDb();
  const timestamp = now();
  const existingRun = db.leadGenRuns.find((item) => item.artifactRunId === input.run.artifactRunId);
  let run: LeadGenRun;

  if (existingRun) {
    run = { ...existingRun, ...input.run, updatedAt: timestamp };
    db.leadGenRuns = db.leadGenRuns.map((item) => (item.id === existingRun.id ? run : item));
  } else {
    run = {
      ...input.run,
      id: id(),
      createdAt: timestamp,
      updatedAt: timestamp
    };
    db.leadGenRuns.push(run);
  }

  for (const candidateInput of input.candidates) {
    const existingIndex = db.people.findIndex(
      (item) => item.leadGenRunId === run.id && item.identityKey === candidateInput.identityKey
    );
    if (existingIndex === -1) {
      db.people.push({
        id: id(),
        status: "candidate",
        name: candidateInput.fullName,
        title: candidateInput.currentTitle,
        emailVerified: false,
        linkedinUrl: candidateInput.linkedinUrl,
        location: candidateInput.resolvedLocation,
        yearsAtCurrentRole: candidateInput.yearsAtCurrentRole,
        source: "Lead generation",
        notes: candidateInput.notes,
        confidenceScore: 50,
        companyName: candidateInput.currentCompany || run.seedCompanyName,
        companyPainPoints: [],
        companyFitScore: 0,
        leadGenRunId: run.id,
        identityKey: candidateInput.identityKey,
        identityKeyType: candidateInput.identityKeyType,
        sourceQueryIds: candidateInput.sourceQueryIds,
        sourceQueryNames: candidateInput.sourceQueryNames,
        sourceBuckets: candidateInput.sourceBuckets,
        overlapCount: candidateInput.overlapCount,
        artifactRefs: candidateInput.artifactRefs,
        createdAt: timestamp,
        updatedAt: timestamp
      });
      continue;
    }
    const existing = db.people[existingIndex];
    db.people[existingIndex] = {
      ...existing,
      title: candidateInput.currentTitle ?? existing.title,
      linkedinUrl: existing.linkedinUrl || candidateInput.linkedinUrl,
      companyName: candidateInput.currentCompany || existing.companyName,
      location: candidateInput.resolvedLocation ?? existing.location,
      yearsAtCurrentRole: candidateInput.yearsAtCurrentRole ?? existing.yearsAtCurrentRole,
      sourceQueryIds: candidateInput.sourceQueryIds,
      sourceQueryNames: candidateInput.sourceQueryNames,
      sourceBuckets: candidateInput.sourceBuckets,
      overlapCount: candidateInput.overlapCount,
      artifactRefs: candidateInput.artifactRefs,
      updatedAt: timestamp
    };
  }
  await writeDb(db);
  return run;
}

export async function createOutreachResearch(input: Omit<OutreachResearch, "id" | "createdAt" | "updatedAt">) {
  const db = await readDb();
  const timestamp = now();
  const record: OutreachResearch = {
    ...input,
    id: id(),
    createdAt: timestamp,
    updatedAt: timestamp
  };
  db.outreachResearch.push(record);
  await writeDb(db);
  return record;
}

export async function createOutreachJob(people: Array<{ id: string; name: string }>): Promise<OutreachJob> {
  const db = await readDb();
  const timestamp = now();
  const job: OutreachJob = {
    id: id(),
    items: people.map((person) => ({ personId: person.id, name: person.name, status: "pending" })),
    createdAt: timestamp,
    updatedAt: timestamp
  };
  db.outreachJobs.push(job);
  await writeDb(db);
  return job;
}

export async function getOutreachJob(jobId: string) {
  const db = await readDb();
  return db.outreachJobs.find((item) => item.id === jobId) || null;
}

export async function updateOutreachJobItem(
  jobId: string,
  personId: string,
  status: OutreachJobItemStatus,
  errorMessage?: string
) {
  const db = await readDb();
  const job = db.outreachJobs.find((item) => item.id === jobId);
  if (!job) return;
  const item = job.items.find((entry) => entry.personId === personId);
  if (!item) return;
  item.status = status;
  item.errorMessage = errorMessage;
  job.updatedAt = now();
  await writeDb(db);
}
