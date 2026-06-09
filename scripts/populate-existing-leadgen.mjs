import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

const root = process.cwd();
const dbPath = path.join(root, "data", "db.json");
const runsRoot = path.join(root, "lead_generation_mod", "data", "runs");
const importerVersion = "leadgen-import-v1";

function now() {
  return new Date().toISOString();
}

function id() {
  return crypto.randomUUID();
}

function clean(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || undefined;
}

function normalizeText(value) {
  return clean(value)?.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ") || "";
}

function normalizeLinkedinUrl(value) {
  const raw = clean(value);
  if (!raw || raw === "https://" || raw === "http://") return undefined;
  try {
    const url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    const pathName = url.pathname.replace(/\/+$/, "");
    return `${url.hostname.replace(/^www\./, "").toLowerCase()}${pathName.toLowerCase()}`;
  } catch {
    return raw.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
  }
}

function identityFor(candidate) {
  const linkedin = normalizeLinkedinUrl(candidate.linkedin_url);
  if (linkedin) return { identityKey: linkedin, identityKeyType: "linkedinUrl" };
  return {
    identityKey: `${normalizeText(candidate.full_name)}::${normalizeText(candidate.current_company)}`,
    identityKeyType: "nameCompany"
  };
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function emptyDb() {
  return {
    prospects: [],
    personas: [],
    contacts: [],
    drafts: [],
    activities: [],
    leadGenRuns: [],
    leadCandidates: [],
    outreachResearch: []
  };
}

function prospectForRun(db, seed) {
  const normalizedCompany = normalizeText(seed.company_name);
  let prospect = db.prospects.find((item) => normalizeText(item.companyName) === normalizedCompany);
  const timestamp = now();
  if (!prospect) {
    prospect = {
      id: id(),
      companyName: seed.company_name,
      industry: "Imported lead generation sample",
      segment: "Lead generation",
      notes: `Created from existing lead generation artifact for seed ${seed.person_name}.`,
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
      message: `Created prospect workspace for ${prospect.companyName} from existing lead generation artifacts.`,
      createdAt: timestamp
    });
  }
  return prospect;
}

async function importRun(db, artifactRunId) {
  const runDir = path.join(runsRoot, artifactRunId);
  const [queries, decisions, batch, runSummary] = await Promise.all([
    readJson(path.join(runDir, "queries.json")),
    readJson(path.join(runDir, "filter_decisions.json")),
    readJson(path.join(runDir, "batch.json")),
    readJson(path.join(runDir, "run_summary.json")).catch(() => ({}))
  ]);
  const seed = batch.seed_person;
  const prospect = prospectForRun(db, seed);
  const timestamp = now();

  let run = db.leadGenRuns.find((item) => item.prospectId === prospect.id && item.artifactRunId === artifactRunId);
  if (!run) {
    run = {
      id: id(),
      prospectId: prospect.id,
      seedPersonName: seed.person_name,
      seedRole: clean(seed.role),
      seedCompanyName: seed.company_name,
      seedLinkedinUrl: clean(seed.linkedin_url),
      status: "completed",
      artifactRunId,
      artifactPath: runDir,
      importerVersion,
      completedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    db.leadGenRuns.push(run);
  } else {
    Object.assign(run, {
      seedPersonName: seed.person_name,
      seedRole: clean(seed.role),
      seedCompanyName: seed.company_name,
      seedLinkedinUrl: clean(seed.linkedin_url),
      status: "completed",
      artifactPath: runDir,
      importerVersion,
      completedAt: timestamp,
      updatedAt: timestamp
    });
  }

  const queryById = new Map(queries.map((query) => [query.vector_id, query]));
  const grouped = new Map();
  decisions.forEach((decision, index) => {
    const candidate = decision.candidate || {};
    const fullName = clean(candidate.full_name);
    if (!fullName) return;
    const identity = identityFor(candidate);
    if (!identity.identityKey || identity.identityKey === "::") return;
    if (!grouped.has(identity.identityKey)) {
      grouped.set(identity.identityKey, {
        identity,
        candidate,
        queryIds: new Set(),
        queryNames: new Set(),
        buckets: new Set(),
        statuses: new Set(),
        mappedRefs: new Set(),
        filterRefs: new Set()
      });
    }
    const record = grouped.get(identity.identityKey);
    const queryId = candidate.source_vector_id;
    record.queryIds.add(queryId);
    record.queryNames.add(candidate.source_vector_name || queryById.get(queryId)?.vector_name || queryId);
    if (candidate.source_bucket) record.buckets.add(candidate.source_bucket);
    record.statuses.add(decision.status || "needs_review");
    if (candidate.exa_entity_id) record.mappedRefs.add(candidate.exa_entity_id);
    if (candidate.exa_result_id) record.mappedRefs.add(candidate.exa_result_id);
    record.filterRefs.add(String(index));
  });

  const statusPriority = { imported: 4, accepted: 3, needs_review: 2, dropped: 1 };
  const importedCandidates = Array.from(grouped.values()).map((record) => {
    const queryIds = Array.from(record.queryIds).sort();
    const statuses = Array.from(record.statuses).sort((a, b) => statusPriority[b] - statusPriority[a]);
    return {
      identityKey: record.identity.identityKey,
      identityKeyType: record.identity.identityKeyType,
      linkedinUrl: normalizeLinkedinUrl(record.candidate.linkedin_url) ? clean(record.candidate.linkedin_url) : undefined,
      fullName: clean(record.candidate.full_name),
      currentTitle: clean(record.candidate.current_title),
      currentCompany: clean(record.candidate.current_company),
      resolvedLocation: clean(record.candidate.resolved_location),
      yearsAtCurrentRole: record.candidate.years_at_current_role,
      sourceQueryIds: queryIds,
      sourceQueryNames: Array.from(record.queryNames).sort(),
      sourceBuckets: Array.from(record.buckets).sort(),
      overlapCount: queryIds.length,
      status: statuses[0] || "needs_review",
      artifactRefs: {
        mappedCandidateIds: Array.from(record.mappedRefs).sort(),
        filterDecisionIds: Array.from(record.filterRefs).sort(),
        queryIds
      }
    };
  });

  for (const candidateInput of importedCandidates) {
    const existing = db.leadCandidates.find((item) => item.leadGenRunId === run.id && item.identityKey === candidateInput.identityKey);
    if (existing) {
      Object.assign(existing, {
        ...candidateInput,
        status: existing.importedContactId ? "imported" : candidateInput.status,
        updatedAt: timestamp
      });
    } else {
      db.leadCandidates.push({
        ...candidateInput,
        id: id(),
        leadGenRunId: run.id,
        prospectId: prospect.id,
        createdAt: timestamp,
        updatedAt: timestamp
      });
    }
  }

  const candidates = db.leadCandidates.filter((candidate) => candidate.leadGenRunId === run.id);
  const candidatesByQuery = new Map(queries.map((query) => [query.vector_id, new Set()]));
  for (const candidate of candidates) {
    for (const queryId of candidate.sourceQueryIds) {
      candidatesByQuery.get(queryId)?.add(candidate.identityKey);
    }
  }
  run.queryStats = queries.map((query) => {
    const identities = candidatesByQuery.get(query.vector_id) || new Set();
    let uniqueCount = 0;
    let overlapCount = 0;
    for (const identityKey of identities) {
      const candidate = candidates.find((item) => item.identityKey === identityKey);
      if ((candidate?.sourceQueryIds.length || 0) > 1) overlapCount += 1;
      else uniqueCount += 1;
    }
    return {
      vectorId: query.vector_id,
      vectorName: query.vector_name,
      resultCount: identities.size,
      uniqueCount,
      overlapCount
    };
  });

  run.queryPairOverlaps = [];
  for (let leftIndex = 0; leftIndex < queries.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < queries.length; rightIndex += 1) {
      const left = queries[leftIndex];
      const right = queries[rightIndex];
      const leftSet = candidatesByQuery.get(left.vector_id) || new Set();
      const rightSet = candidatesByQuery.get(right.vector_id) || new Set();
      const sharedCandidateIds = Array.from(leftSet).filter((identityKey) => rightSet.has(identityKey));
      if (sharedCandidateIds.length) {
        run.queryPairOverlaps.push({
          queryAId: left.vector_id,
          queryBId: right.vector_id,
          sharedCandidateIds,
          sharedCount: sharedCandidateIds.length
        });
      }
    }
  }
  run.summary = {
    totalCandidates: candidates.length,
    acceptedCandidates: candidates.filter((candidate) => candidate.status === "accepted" || candidate.status === "imported").length,
    droppedCandidates: candidates.filter((candidate) => candidate.status === "dropped").length,
    needsReviewCandidates: candidates.filter((candidate) => candidate.status === "needs_review").length
  };
  run.stdoutSnippet = typeof runSummary.status === "string" ? runSummary.status : undefined;

  db.activities.push({
    id: id(),
    prospectId: prospect.id,
    type: "leadgen_imported",
    message: `Imported existing lead generation run ${artifactRunId}.`,
    createdAt: timestamp
  });

  return { prospect: prospect.companyName, artifactRunId, candidates: candidates.length };
}

const db = { ...emptyDb(), ...JSON.parse(await fs.readFile(dbPath, "utf8")) };
const entries = await fs.readdir(runsRoot, { withFileTypes: true });
const runIds = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
const results = [];
for (const runId of runIds) {
  results.push(await importRun(db, runId));
}

await fs.writeFile(dbPath, JSON.stringify(db, null, 2));
console.log(JSON.stringify({ importedRuns: results, totalRuns: db.leadGenRuns.length, totalCandidates: db.leadCandidates.length }, null, 2));
