import { promises as fs } from "fs";
import path from "path";
import type {
  Activity,
  BuyerPersona,
  Contact,
  Database,
  DraftTone,
  LeadCandidate,
  LeadGenRun,
  OutreachDraft,
  OutreachResearch,
  Prospect,
  ProspectStatus,
  ProspectWorkspace
} from "./types";

const dataDir = path.join(process.cwd(), "data");
const dbPath = path.join(dataDir, "db.json");

const emptyDb: Database = {
  prospects: [],
  personas: [],
  contacts: [],
  drafts: [],
  activities: [],
  leadGenRuns: [],
  leadCandidates: [],
  outreachResearch: []
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

function sortUpdated(a: Prospect, b: Prospect) {
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

export async function getProspects() {
  const db = await readDb();
  return db.prospects.sort(sortUpdated);
}

export async function getProspectById(id: string): Promise<ProspectWorkspace | null> {
  const db = await readDb();
  const prospect = db.prospects.find((item) => item.id === id);
  if (!prospect) return null;
  return {
    prospect,
    personas: db.personas.filter((item) => item.prospectId === id),
    contacts: db.contacts.filter((item) => item.prospectId === id),
    drafts: db.drafts.filter((item) => item.prospectId === id),
    leadGenRuns: db.leadGenRuns.filter((item) => item.prospectId === id),
    leadCandidates: db.leadCandidates.filter((item) => item.prospectId === id),
    outreachResearch: db.outreachResearch.filter((item) => item.prospectId === id),
    activities: db.activities
      .filter((item) => item.prospectId === id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  };
}

export async function createProspect(input: {
  companyName: string;
  website?: string;
  industry?: string;
  companySize?: string;
  segment?: string;
  notes?: string;
}) {
  const db = await readDb();
  const timestamp = now();
  const prospect: Prospect = {
    id: id(),
    companyName: input.companyName,
    website: input.website,
    industry: input.industry,
    companySize: input.companySize,
    segment: input.segment,
    notes: input.notes,
    painPoints: [],
    smartSentryFitScore: 0,
    status: "researching",
    createdAt: timestamp,
    updatedAt: timestamp
  };
  db.prospects.push(prospect);
  db.activities.push({
    id: id(),
    prospectId: prospect.id,
    type: "created",
    message: `Created prospect workspace for ${prospect.companyName}.`,
    createdAt: timestamp
  });
  await writeDb(db);
  return prospect;
}

export async function updateProspect(
  prospectId: string,
  input: Partial<Omit<Prospect, "id" | "createdAt" | "updatedAt">>
) {
  const db = await readDb();
  const index = db.prospects.findIndex((item) => item.id === prospectId);
  if (index === -1) throw new Error("Prospect not found");
  db.prospects[index] = { ...db.prospects[index], ...input, updatedAt: now() };
  await writeDb(db);
  return db.prospects[index];
}

export async function deleteProspect(prospectId: string) {
  const db = await readDb();
  db.prospects = db.prospects.filter((item) => item.id !== prospectId);
  db.personas = db.personas.filter((item) => item.prospectId !== prospectId);
  db.contacts = db.contacts.filter((item) => item.prospectId !== prospectId);
  db.drafts = db.drafts.filter((item) => item.prospectId !== prospectId);
  db.activities = db.activities.filter((item) => item.prospectId !== prospectId);
  db.leadGenRuns = db.leadGenRuns.filter((item) => item.prospectId !== prospectId);
  db.leadCandidates = db.leadCandidates.filter((item) => item.prospectId !== prospectId);
  db.outreachResearch = db.outreachResearch.filter((item) => item.prospectId !== prospectId);
  await writeDb(db);
}

export async function replaceResearchBrief(
  prospectId: string,
  brief: {
    summary: string;
    painPoints: string[];
    securityRelevance: string;
    smartSentryFitScore: number;
    fitRationale: string;
    recommendedPersonas: Array<Omit<BuyerPersona, "id" | "prospectId">>;
  }
) {
  const db = await readDb();
  const prospect = db.prospects.find((item) => item.id === prospectId);
  if (!prospect) throw new Error("Prospect not found");
  Object.assign(prospect, {
    summary: brief.summary,
    painPoints: brief.painPoints,
    securityRelevance: brief.securityRelevance,
    smartSentryFitScore: brief.smartSentryFitScore,
    fitRationale: brief.fitRationale,
    status: "drafting" satisfies ProspectStatus,
    updatedAt: now()
  });
  db.personas = db.personas.filter((item) => item.prospectId !== prospectId);
  db.personas.push(
    ...brief.recommendedPersonas.map((persona) => ({
      ...persona,
      id: id(),
      prospectId
    }))
  );
  db.activities.push({
    id: id(),
    prospectId,
    type: "research_generated",
    message: "Generated company intelligence, fit score, and buyer personas.",
    createdAt: now()
  });
  await writeDb(db);
}

export async function createContact(
  prospectId: string,
  input: Omit<Contact, "id" | "prospectId" | "confidenceScore" | "emailVerified" | "createdAt" | "updatedAt">
) {
  const db = await readDb();
  const timestamp = now();
  const contact: Contact = {
    ...input,
    id: id(),
    prospectId,
    confidenceScore: 50,
    emailVerified: false,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  db.contacts.push(contact);
  db.activities.push({
    id: id(),
    prospectId,
    type: "contact_created",
    message: `Added contact ${contact.name || contact.title}. Email remains unverified until manually confirmed.`,
    createdAt: timestamp
  });
  await writeDb(db);
  return contact;
}

export async function updateContact(contactId: string, input: Partial<Contact>) {
  const db = await readDb();
  const index = db.contacts.findIndex((item) => item.id === contactId);
  if (index === -1) throw new Error("Contact not found");
  db.contacts[index] = { ...db.contacts[index], ...input, updatedAt: now() };
  await writeDb(db);
  return db.contacts[index];
}

export async function updateContactScore(
  contactId: string,
  score: { confidenceScore: number; relevanceReason: string; bestPersonaMatch?: string }
) {
  const db = await readDb();
  const contact = db.contacts.find((item) => item.id === contactId);
  if (!contact) throw new Error("Contact not found");
  Object.assign(contact, { ...score, updatedAt: now() });
  db.activities.push({
    id: id(),
    prospectId: contact.prospectId,
    type: "contact_scored",
    message: `Scored ${contact.name || contact.title} at ${score.confidenceScore}/100 for Smart Sentry relevance.`,
    createdAt: now()
  });
  await writeDb(db);
}

export async function createOutreachDraft(
  prospectId: string,
  input: {
    contactId?: string;
    candidateId?: string;
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
        item.prospectId === prospectId &&
        item.status !== "approved" &&
        ((input.contactId && item.contactId === input.contactId) ||
          (input.candidateId && item.candidateId === input.candidateId) ||
          (input.outreachResearchId && item.outreachResearchId === input.outreachResearchId))
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
      prospectId,
      type: "draft_updated",
      message: "Updated the existing outreach draft for this contact.",
      createdAt: timestamp
    });
    await writeDb(db);
    return existingDraft;
  }

  const draft: OutreachDraft = {
    id: id(),
    prospectId,
    contactId: input.contactId,
    candidateId: input.candidateId,
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
  const prospect = db.prospects.find((item) => item.id === prospectId);
  if (prospect) {
    prospect.status = "drafting";
    prospect.updatedAt = timestamp;
  }
  db.activities.push({
    id: id(),
    prospectId,
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
    prospectId: draft.prospectId,
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
    const prospect = db.prospects.find((item) => item.id === draft.prospectId);
    if (prospect) {
      prospect.status = "approved";
      prospect.updatedAt = now();
    }
    db.activities.push({
      id: id(),
      prospectId: draft.prospectId,
      type: "draft_approved",
      message: "Approved outreach draft after manual review.",
      createdAt: now()
    });
  }
  await writeDb(db);
  return draft;
}

export async function addActivity(prospectId: string, type: string, message: string): Promise<Activity> {
  const db = await readDb();
  const activity = { id: id(), prospectId, type, message, createdAt: now() };
  db.activities.push(activity);
  await writeDb(db);
  return activity;
}

export async function getLeadGenRuns(prospectId: string) {
  const db = await readDb();
  return db.leadGenRuns
    .filter((item) => item.prospectId === prospectId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function getLeadCandidatesForRun(prospectId: string, leadGenRunId: string) {
  const db = await readDb();
  return db.leadCandidates.filter((item) => item.prospectId === prospectId && item.leadGenRunId === leadGenRunId);
}

export async function upsertImportedLeadGenRun(input: {
  run: Omit<LeadGenRun, "id" | "createdAt" | "updatedAt">;
  candidates: Array<Omit<LeadCandidate, "id" | "leadGenRunId" | "prospectId" | "createdAt" | "updatedAt">>;
}) {
  const db = await readDb();
  const timestamp = now();
  const existingRun = db.leadGenRuns.find(
    (item) => item.prospectId === input.run.prospectId && item.artifactRunId === input.run.artifactRunId
  );
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

  const nextCandidates = [...db.leadCandidates];
  for (const candidateInput of input.candidates) {
    const existingIndex = nextCandidates.findIndex(
      (item) => item.leadGenRunId === run.id && item.identityKey === candidateInput.identityKey
    );
    if (existingIndex === -1) {
      nextCandidates.push({
        ...candidateInput,
        id: id(),
        leadGenRunId: run.id,
        prospectId: run.prospectId,
        createdAt: timestamp,
        updatedAt: timestamp
      });
      continue;
    }
    const existing = nextCandidates[existingIndex];
    nextCandidates[existingIndex] = {
      ...existing,
      ...candidateInput,
      id: existing.id,
      leadGenRunId: run.id,
      prospectId: run.prospectId,
      importedContactId: existing.importedContactId,
      status: existing.importedContactId ? "imported" : candidateInput.status,
      createdAt: existing.createdAt,
      updatedAt: timestamp
    };
  }
  db.leadCandidates = nextCandidates;
  db.activities.push({
    id: id(),
    prospectId: run.prospectId,
    type: "leadgen_imported",
    message: `Imported lead generation run ${run.artifactRunId}.`,
    createdAt: timestamp
  });
  await writeDb(db);
  return run;
}

export async function importLeadCandidateAsContact(prospectId: string, candidateId: string) {
  const db = await readDb();
  const candidate = db.leadCandidates.find((item) => item.id === candidateId && item.prospectId === prospectId);
  if (!candidate) throw new Error("Lead candidate not found");

  const normalizedLinkedin = candidate.linkedinUrl?.trim().toLowerCase();
  const normalizedName = candidate.fullName.trim().toLowerCase();
  const normalizedCompany = candidate.currentCompany?.trim().toLowerCase();
  const existingContact = db.contacts.find((contact) => {
    if (normalizedLinkedin && contact.linkedinUrl?.trim().toLowerCase() === normalizedLinkedin) return true;
    const contactNotes = contact.notes?.trim().toLowerCase() || "";
    return (
      !normalizedLinkedin &&
      contact.name.trim().toLowerCase() === normalizedName &&
      (!normalizedCompany || contactNotes.includes(normalizedCompany))
    );
  });
  const timestamp = now();
  let contactId: string;

  if (existingContact) {
    contactId = existingContact.id;
  } else {
    const contact: Contact = {
      id: id(),
      prospectId,
      name: candidate.fullName,
      title: candidate.currentTitle || "",
      email: undefined,
      linkedinUrl: candidate.linkedinUrl,
      source: "Lead generation",
      confidenceScore: candidate.status === "accepted" ? 70 : 50,
      relevanceReason: candidate.sourceQueryNames?.length
        ? `Found by ${candidate.sourceQueryNames.join(", ")}.`
        : "Imported from lead generation.",
      notes:
        [
          candidate.currentCompany ? `Company: ${candidate.currentCompany}` : undefined,
          candidate.resolvedLocation ? `Location: ${candidate.resolvedLocation}` : undefined
        ]
          .filter(Boolean)
          .join(" | ") || undefined,
      emailVerified: false,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    db.contacts.push(contact);
    contactId = contact.id;
  }

  db.leadCandidates = db.leadCandidates.map((item) =>
    item.id === candidate.id ? { ...item, status: "imported", importedContactId: contactId, updatedAt: timestamp } : item
  );
  db.activities.push({
    id: id(),
    prospectId,
    type: "candidate_imported",
    message: `Imported ${candidate.fullName} as a contact.`,
    createdAt: timestamp
  });
  await writeDb(db);
  return contactId;
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

export async function getContactById(prospectId: string, contactId: string) {
  const db = await readDb();
  return db.contacts.find((item) => item.id === contactId && item.prospectId === prospectId) || null;
}

export async function getLeadCandidateById(prospectId: string, candidateId: string) {
  const db = await readDb();
  return db.leadCandidates.find((item) => item.id === candidateId && item.prospectId === prospectId) || null;
}

export async function getAllCandidates() {
  const db = await readDb();
  const prospectMap = new Map(db.prospects.map((p) => [p.id, p.companyName]));
  return db.leadCandidates
    .map((c) => ({ ...c, prospectCompanyName: prospectMap.get(c.prospectId) ?? "Unknown" }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}
