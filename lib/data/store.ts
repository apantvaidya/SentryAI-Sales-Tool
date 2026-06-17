import { promises as fs } from "fs";
import path from "path";
import type {
  Activity,
  BuyerPersona,
  CandidateIdentityKeyType,
  Campaign,
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
  outreachJobs: [],
  campaigns: []
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
  try {
    return { ...emptyDb, ...JSON.parse(raw) };
  } catch (e) {
    // "Unexpected non-whitespace character after JSON at position N" means valid
    // JSON followed by garbage bytes (concurrent copyFile corruption). Recover by
    // parsing just the clean prefix, then rewrite the file atomically.
    if (e instanceof SyntaxError) {
      const posMatch = e.message.match(/position (\d+)/);
      if (posMatch) {
        const pos = parseInt(posMatch[1], 10);
        try {
          const recovered = { ...emptyDb, ...(JSON.parse(raw.slice(0, pos).trimEnd()) as Partial<Database>) };
          writeDb(recovered).catch(() => {});
          return recovered;
        } catch {}
      }
    }
    throw e;
  }
}

const lockPath = dbPath + ".lock";

async function acquireLock(): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    // Remove stale locks left by crashed processes (older than 30 s)
    try {
      const stat = await fs.stat(lockPath);
      if (Date.now() - stat.mtimeMs > 30_000) await fs.unlink(lockPath).catch(() => {});
    } catch {}
    try {
      // O_EXCL: atomically fail if the file already exists
      const h = await fs.open(lockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY);
      await h.close();
      return;
    } catch {
      await new Promise<void>((r) => setTimeout(r, 10 + Math.random() * 40));
    }
  }
  // Deadline exceeded — force-break the lock so the app isn't stuck forever
  await fs.unlink(lockPath).catch(() => {});
}

async function releaseLock(): Promise<void> {
  await fs.unlink(lockPath).catch(() => {});
}

// Module-level queue — serialises writes within a single process.
// The file lock below coordinates across multiple Next.js worker processes.
let _writeQueue: Promise<void> = Promise.resolve();

async function writeDb(db: Database): Promise<void> {
  const doWrite = async () => {
    await acquireLock();
    try {
      await ensureDb();
      const content = JSON.stringify(db, null, 2) + "\n";
      const tmpPath = dbPath + ".tmp";
      await fs.writeFile(tmpPath, content, "utf8");
      // Atomic replace with retries — on Windows the destination may be briefly
      // locked by a reader, so retry before falling back to non-atomic copyFile.
      let renamed = false;
      for (let i = 0; i < 5 && !renamed; i++) {
        try {
          await fs.rename(tmpPath, dbPath);
          renamed = true;
        } catch {
          if (i < 4) await new Promise<void>((r) => setTimeout(r, 20 * (i + 1)));
        }
      }
      if (!renamed) {
        await fs.copyFile(tmpPath, dbPath);
        await fs.unlink(tmpPath).catch(() => {});
      }
    } finally {
      await releaseLock();
    }
  };

  const queued = _writeQueue.then(doWrite);
  _writeQueue = queued.catch(() => {});
  await queued;
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

function withDerivedStatus(people: Person[], drafts: { personId: string }[]): Person[] {
  const hasDraft = new Set(drafts.map((d) => d.personId));
  return people.map((p) =>
    (p.status === "new" || p.status === "candidate") && hasDraft.has(p.id)
      ? { ...p, status: "drafting" as PersonStatus }
      : p
  );
}

export async function getPersons() {
  const db = await readDb();
  return withDerivedStatus(db.people, db.drafts).sort(sortUpdated);
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
  campaignId: string;
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
    campaignId: input.campaignId,
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

export async function bulkDeletePeople(personIds: string[]) {
  const db = await readDb();
  const idSet = new Set(personIds);
  db.people = db.people.filter((item) => !idSet.has(item.id));
  db.personas = db.personas.filter((item) => !idSet.has(item.personId));
  db.drafts = db.drafts.filter((item) => !idSet.has(item.personId));
  db.activities = db.activities.filter((item) => !idSet.has(item.personId));
  db.outreachResearch = db.outreachResearch.filter((item) => !idSet.has(item.personId));
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
  return withDerivedStatus(
    db.people.filter((item) => item.leadGenRunId === leadGenRunId),
    db.drafts
  );
}

export async function upsertImportedLeadGenRun(input: {
  run: Omit<LeadGenRun, "id" | "createdAt" | "updatedAt">;
  campaignId: string;
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
        campaignId: input.campaignId,
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

export async function getCampaigns() {
  const db = await readDb();
  return db.campaigns.slice().sort((a, b) => a.name.localeCompare(b.name));
}

export async function getCampaign(campaignId: string) {
  const db = await readDb();
  return db.campaigns.find((item) => item.id === campaignId) || null;
}

export async function createCampaign(name: string) {
  const db = await readDb();
  const timestamp = now();
  const campaign: Campaign = { id: id(), name, createdAt: timestamp, updatedAt: timestamp };
  db.campaigns.push(campaign);
  await writeDb(db);
  return campaign;
}

export async function assignCampaign(personIds: string[], campaignId: string) {
  const db = await readDb();
  const idSet = new Set(personIds);
  const timestamp = now();
  for (const person of db.people) {
    if (idSet.has(person.id)) {
      person.campaignId = campaignId;
      person.updatedAt = timestamp;
    }
  }
  await writeDb(db);
}

export async function importPeopleFromCsv(
  entries: Array<{
    campaignId: string;
    name: string;
    companyName: string;
    title?: string;
    email?: string;
    linkedinUrl?: string;
    location?: string;
    notes?: string;
    source?: string;
    companyWebsite?: string;
  }>
) {
  const db = await readDb();
  const timestamp = now();
  const created: Person[] = [];
  for (const entry of entries) {
    const person: Person = {
      id: id(),
      campaignId: entry.campaignId,
      status: "new",
      name: entry.name,
      title: entry.title,
      email: entry.email,
      emailVerified: false,
      linkedinUrl: entry.linkedinUrl,
      location: entry.location,
      source: entry.source || "CSV import",
      notes: entry.notes,
      confidenceScore: 50,
      companyName: entry.companyName,
      companyWebsite: entry.companyWebsite,
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
      message: `Imported ${person.name} at ${person.companyName} via CSV.`,
      createdAt: timestamp
    });
    created.push(person);
  }

  // deduplicate within this campaign (existing + newly imported) in one write
  const campaignId = entries[0].campaignId;
  const campaignScope = new Set(db.people.filter((p) => p.campaignId === campaignId).map((p) => p.id));
  deduplicateInDb(db, campaignScope);

  await writeDb(db);
  return created;
}

// ---- deduplication helpers (used during CSV import) ----

function normLinkedin(url?: string | null): string | null {
  if (!url) return null;
  const s = url.toLowerCase().replace(/^https?:\/\/(www\.)?linkedin\.com/, "").replace(/\/$/, "").trim();
  return s || null;
}

function normName(s?: string | null): string {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function uniqueStrings(arr: (string | undefined | null)[]): string[] {
  return Array.from(new Set(arr.filter((x): x is string => Boolean(x))));
}

const STATUS_RANK: Record<string, number> = { contacted: 5, approved: 4, drafting: 3, new: 2, candidate: 1 };

function personScoreInDb(p: Person, db: Database): number {
  const drafts = db.drafts.filter((d) => d.personId === p.id);
  const research = db.outreachResearch.filter((r) => r.personId === p.id);
  const activities = db.activities.filter((a) => a.personId === p.id);
  return (
    (STATUS_RANK[p.status] || 0) * 1000 +
    drafts.filter((d) => d.status === "approved").length * 800 +
    drafts.length * 400 +
    research.length * 200 +
    activities.length * 10 +
    (p.email ? 50 : 0) +
    p.confidenceScore
  );
}

function deduplicateInDb(db: Database, scope: Set<string>): number {
  const people = db.people.filter((p) => scope.has(p.id));

  const byLinkedin = new Map<string, Person[]>();
  const byNameCompany = new Map<string, Person[]>();
  const inLinkedinGroup = new Set<string>();

  for (const p of people) {
    const li = normLinkedin(p.linkedinUrl);
    if (li) {
      if (!byLinkedin.has(li)) byLinkedin.set(li, []);
      byLinkedin.get(li)!.push(p);
      inLinkedinGroup.add(p.id);
    }
  }
  for (const p of people) {
    if (inLinkedinGroup.has(p.id)) continue;
    const key = normName(p.name) + "|" + normName(p.companyName);
    if (!byNameCompany.has(key)) byNameCompany.set(key, []);
    byNameCompany.get(key)!.push(p);
  }

  const dupGroups = [
    ...Array.from(byLinkedin.values()),
    ...Array.from(byNameCompany.values()),
  ].filter((g) => g.length > 1);

  const removedIds = new Set<string>();
  const remapId = new Map<string, string>();

  for (const group of dupGroups) {
    const scored = group
      .map((p) => ({ p, s: personScoreInDb(p, db) }))
      .sort((a, b) => b.s - a.s || a.p.createdAt.localeCompare(b.p.createdAt));
    const winner = scored[0].p;
    const losers = scored.slice(1).map((x) => x.p);

    for (const loser of losers) {
      remapId.set(loser.id, winner.id);
      removedIds.add(loser.id);
    }

    winner.linkedinUrl = winner.linkedinUrl || losers.map((l) => l.linkedinUrl).find(Boolean);
    winner.email = winner.email || losers.map((l) => l.email).find(Boolean);
    winner.location = winner.location || losers.map((l) => l.location).find(Boolean);
    winner.title = winner.title || losers.map((l) => l.title).find(Boolean);
    winner.sourceQueryIds = uniqueStrings([...(winner.sourceQueryIds || []), ...losers.flatMap((l) => l.sourceQueryIds || [])]);
    winner.sourceQueryNames = uniqueStrings([...(winner.sourceQueryNames || []), ...losers.flatMap((l) => l.sourceQueryNames || [])]);
    winner.sourceBuckets = uniqueStrings([...(winner.sourceBuckets || []), ...losers.flatMap((l) => l.sourceBuckets || [])]);
    winner.overlapCount = Math.max(winner.overlapCount || 0, winner.sourceQueryIds.length);
    winner.updatedAt = now();
  }

  for (const record of [...db.drafts, ...db.outreachResearch, ...db.activities, ...db.personas]) {
    const newId = remapId.get(record.personId);
    if (newId) record.personId = newId;
  }

  db.people = db.people.filter((p) => !removedIds.has(p.id));
  return removedIds.size;
}

// ---- end deduplication helpers ----

export async function getPersonsForCampaigns(campaignIds: string[]) {
  const db = await readDb();
  const idSet = new Set(campaignIds);
  const people = withDerivedStatus(
    db.people.filter((p) => idSet.has(p.campaignId)).slice().sort(sortUpdated),
    db.drafts
  );
  return people.map((person) => ({
    person,
    drafts: db.drafts.filter((d) => d.personId === person.id)
  }));
}
