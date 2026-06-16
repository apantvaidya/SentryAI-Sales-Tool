import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = path.join(root, "data", "db.json");
const backupPath = path.join(root, "data", "db.backup.json");

function now() {
  return new Date().toISOString();
}

const raw = await fs.readFile(dbPath, "utf8");
const oldDb = JSON.parse(raw);
await fs.writeFile(backupPath, raw);

const prospectById = new Map(oldDb.prospects.map((p) => [p.id, p]));
const companyFieldsFromProspect = (prospect) => ({
  companyName: prospect?.companyName || "Unknown company",
  companyWebsite: prospect?.website,
  companyIndustry: prospect?.industry,
  companySize: prospect?.companySize,
  companySegment: prospect?.segment,
  companyNotes: prospect?.notes,
  companySummary: prospect?.summary,
  companyPainPoints: prospect?.painPoints || [],
  companySecurityRelevance: prospect?.securityRelevance,
  companyFitScore: prospect?.smartSentryFitScore ?? 0,
  companyFitRationale: prospect?.fitRationale
});

const people = [];
const personIdsFromContacts = new Set();

// Step 1: contacts -> Person (preserve id)
for (const contact of oldDb.contacts) {
  const prospect = prospectById.get(contact.prospectId);
  const candidate = oldDb.leadCandidates.find((c) => c.importedContactId === contact.id);
  const drafts = oldDb.drafts.filter((d) => d.contactId === contact.id || d.candidateId === candidate?.id);
  const hasApprovedDraft = drafts.some((d) => d.status === "approved");
  const status = hasApprovedDraft ? "approved" : drafts.length > 0 ? "drafting" : "new";

  people.push({
    id: contact.id,
    status,
    name: contact.name,
    title: contact.title,
    email: contact.email,
    emailVerified: contact.emailVerified,
    linkedinUrl: contact.linkedinUrl || candidate?.linkedinUrl,
    location: candidate?.resolvedLocation,
    yearsAtCurrentRole: candidate?.yearsAtCurrentRole,
    source: contact.source,
    notes: contact.notes,
    confidenceScore: contact.confidenceScore,
    relevanceReason: contact.relevanceReason,
    bestPersonaMatch: contact.bestPersonaMatch,
    ...companyFieldsFromProspect(prospect),
    leadGenRunId: candidate?.leadGenRunId,
    identityKey: candidate?.identityKey,
    identityKeyType: candidate?.identityKeyType,
    sourceQueryIds: candidate?.sourceQueryIds,
    sourceQueryNames: candidate?.sourceQueryNames,
    sourceBuckets: candidate?.sourceBuckets,
    overlapCount: candidate?.overlapCount,
    artifactRefs: candidate?.artifactRefs,
    createdAt: contact.createdAt,
    updatedAt: contact.updatedAt
  });
  personIdsFromContacts.add(contact.id);
}

// Step 2: un-imported lead candidates -> Person (preserve id)
for (const candidate of oldDb.leadCandidates) {
  if (candidate.status === "imported") continue; // represented by its contact already
  const prospect = prospectById.get(candidate.prospectId);
  people.push({
    id: candidate.id,
    status: "candidate",
    name: candidate.fullName,
    title: candidate.currentTitle,
    emailVerified: false,
    linkedinUrl: candidate.linkedinUrl,
    location: candidate.resolvedLocation,
    yearsAtCurrentRole: candidate.yearsAtCurrentRole,
    source: "Lead generation",
    confidenceScore: 50,
    ...companyFieldsFromProspect(prospect),
    companyName: candidate.currentCompany || prospect?.companyName || "Unknown company",
    leadGenRunId: candidate.leadGenRunId,
    identityKey: candidate.identityKey,
    identityKeyType: candidate.identityKeyType,
    sourceQueryIds: candidate.sourceQueryIds,
    sourceQueryNames: candidate.sourceQueryNames,
    sourceBuckets: candidate.sourceBuckets,
    overlapCount: candidate.overlapCount,
    artifactRefs: candidate.artifactRefs,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt
  });
}

const personById = new Map(people.map((p) => [p.id, p]));

function resolveDraftPersonId(draft) {
  if (draft.contactId && personById.has(draft.contactId)) return draft.contactId;
  if (draft.candidateId && personById.has(draft.candidateId)) return draft.candidateId;
  return undefined;
}

// Step 3: personas — duplicate per person at that company, reusing the original
// id only for the one person whose existing draft already points at it.
const personaReuse = new Map(); // originalPersonaId -> personId
for (const draft of oldDb.drafts) {
  if (!draft.personaId) continue;
  const personId = resolveDraftPersonId(draft);
  if (personId) personaReuse.set(draft.personaId, personId);
}

const personas = [];
const personasByProspectId = new Map();
for (const persona of oldDb.personas) {
  if (!personasByProspectId.has(persona.prospectId)) personasByProspectId.set(persona.prospectId, []);
  personasByProspectId.get(persona.prospectId).push(persona);
}

for (const person of people) {
  const prospectIdForPerson = [...prospectById.values()].find((p) => p.companyName === person.companyName)?.id;
  // Fall back to matching by original contact/candidate's prospectId directly.
  const originalProspectId =
    oldDb.contacts.find((c) => c.id === person.id)?.prospectId ||
    oldDb.leadCandidates.find((c) => c.id === person.id)?.prospectId ||
    prospectIdForPerson;
  const companyPersonas = personasByProspectId.get(originalProspectId) || [];
  for (const persona of companyPersonas) {
    const reuseFor = personaReuse.get(persona.id);
    const newId = reuseFor === person.id ? persona.id : crypto.randomUUID();
    personas.push({
      id: newId,
      personId: person.id,
      personaName: persona.personaName,
      roleTitles: persona.roleTitles,
      painPoints: persona.painPoints,
      valueProposition: persona.valueProposition,
      objectionHandling: persona.objectionHandling,
      priorityScore: persona.priorityScore
    });
  }
}

// Step 4: activities — company-level activities have no single natural person,
// so attach a copy to every person at that company who already existed by then.
const peopleByOriginalProspectId = new Map();
for (const person of people) {
  const originalProspectId =
    oldDb.contacts.find((c) => c.id === person.id)?.prospectId ||
    oldDb.leadCandidates.find((c) => c.id === person.id)?.prospectId;
  if (!originalProspectId) continue;
  if (!peopleByOriginalProspectId.has(originalProspectId)) peopleByOriginalProspectId.set(originalProspectId, []);
  peopleByOriginalProspectId.get(originalProspectId).push(person);
}

const activities = [];
for (const activity of oldDb.activities) {
  const candidatePeople = peopleByOriginalProspectId.get(activity.prospectId) || [];
  const eligible = candidatePeople.filter((p) => new Date(p.createdAt).getTime() <= new Date(activity.createdAt).getTime());
  const targets = eligible.length > 0 ? eligible : candidatePeople;
  for (const person of targets) {
    activities.push({
      id: targets.length === 1 ? activity.id : crypto.randomUUID(),
      personId: person.id,
      type: activity.type,
      message: activity.message,
      createdAt: activity.createdAt
    });
  }
}

// Step 5: drafts / outreachResearch — contactId/candidateId -> personId
const drafts = oldDb.drafts.map((draft) => {
  const personId = resolveDraftPersonId(draft) || draft.contactId || draft.candidateId;
  return {
    id: draft.id,
    personId,
    personaId: draft.personaId,
    outreachResearchId: draft.outreachResearchId,
    subject: draft.subject,
    body: draft.body,
    tone: draft.tone,
    status: draft.status,
    personalizationNotes: draft.personalizationNotes,
    riskFlags: draft.riskFlags,
    sourceUrls: draft.sourceUrls,
    validationRecommendation: draft.validationRecommendation,
    evidenceSummarySnippet: draft.evidenceSummarySnippet,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt
  };
});

const outreachResearch = oldDb.outreachResearch.map((research) => {
  const personId =
    (research.contactId && personById.has(research.contactId) && research.contactId) ||
    (research.candidateId && personById.has(research.candidateId) && research.candidateId) ||
    research.contactId ||
    research.candidateId;
  return {
    id: research.id,
    personId,
    linkedinUrl: research.linkedinUrl,
    company: research.company,
    location: research.location,
    role: research.role,
    personaType: research.personaType,
    status: research.status,
    model: research.model,
    pipelineVersion: research.pipelineVersion,
    querySet: research.querySet,
    searchResults: research.searchResults,
    evidenceSummary: research.evidenceSummary,
    validation: research.validation,
    sourceUrls: research.sourceUrls,
    validationRecommendation: research.validationRecommendation,
    startedAt: research.startedAt,
    completedAt: research.completedAt,
    createdAt: research.createdAt,
    updatedAt: research.updatedAt,
    errorMessage: research.errorMessage,
    command: research.command,
    exitCode: research.exitCode,
    stdoutSnippet: research.stdoutSnippet,
    stderrSnippet: research.stderrSnippet
  };
});

// Step 6: lead-gen runs lose their prospectId — pure field drop.
const leadGenRuns = oldDb.leadGenRuns.map(({ prospectId, ...rest }) => rest);

const newDb = {
  people,
  personas,
  drafts,
  activities,
  leadGenRuns,
  outreachResearch
};

// Validation
const expectedPeopleCount = oldDb.contacts.length + oldDb.leadCandidates.filter((c) => c.status !== "imported").length;
if (people.length !== expectedPeopleCount) {
  throw new Error(`People count mismatch: got ${people.length}, expected ${expectedPeopleCount}`);
}
const personIdSet = new Set(people.map((p) => p.id));
for (const draft of drafts) {
  if (!personIdSet.has(draft.personId)) throw new Error(`Draft ${draft.id} has unresolved personId ${draft.personId}`);
  if (draft.personaId && !personas.some((p) => p.id === draft.personaId && p.personId === draft.personId)) {
    throw new Error(`Draft ${draft.id} personaId ${draft.personaId} does not resolve for person ${draft.personId}`);
  }
}
for (const research of outreachResearch) {
  if (!personIdSet.has(research.personId)) throw new Error(`Research ${research.id} has unresolved personId ${research.personId}`);
}
for (const activity of activities) {
  if (!personIdSet.has(activity.personId)) throw new Error(`Activity ${activity.id} has unresolved personId ${activity.personId}`);
}

await fs.writeFile(dbPath, `${JSON.stringify(newDb, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      before: {
        prospects: oldDb.prospects.length,
        personas: oldDb.personas.length,
        contacts: oldDb.contacts.length,
        leadCandidates: oldDb.leadCandidates.length,
        drafts: oldDb.drafts.length,
        outreachResearch: oldDb.outreachResearch.length,
        activities: oldDb.activities.length,
        leadGenRuns: oldDb.leadGenRuns.length
      },
      after: {
        people: people.length,
        personas: personas.length,
        drafts: drafts.length,
        outreachResearch: outreachResearch.length,
        activities: activities.length,
        leadGenRuns: leadGenRuns.length
      },
      companies: [...new Set(people.map((p) => p.companyName))]
    },
    null,
    2
  )
);
