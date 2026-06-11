import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = path.join(root, "data", "db.json");

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function unique(values) {
  return Array.from(new Set((values || []).filter(Boolean))).sort();
}

function statusRank(status) {
  return {
    imported: 5,
    accepted: 4,
    needs_review: 3,
    dropped: 1
  }[status] || 0;
}

function roleRank(candidate) {
  const role = normalizeName(candidate.currentTitle);
  if (/(asset protection|loss prevention|security|safety|facilit|construction|operations|store|district|regional)/.test(role)) {
    return 2;
  }
  if (/(manager|director|leader|head|vp|chief)/.test(role)) return 1;
  return 0;
}

function score(candidate) {
  return (
    statusRank(candidate.status) * 1000 +
    Number(candidate.overlapCount || 0) * 100 +
    (candidate.linkedinUrl ? 50 : 0) +
    roleRank(candidate) * 25 +
    (candidate.currentCompany ? 10 : 0) +
    (candidate.resolvedLocation ? 5 : 0)
  );
}

function mergeCandidates(primary, duplicate) {
  const merged = { ...primary };
  merged.sourceQueryIds = unique([...(primary.sourceQueryIds || []), ...(duplicate.sourceQueryIds || [])]);
  merged.sourceQueryNames = unique([...(primary.sourceQueryNames || []), ...(duplicate.sourceQueryNames || [])]);
  merged.sourceBuckets = unique([...(primary.sourceBuckets || []), ...(duplicate.sourceBuckets || [])]);
  merged.overlapCount = Math.max(Number(primary.overlapCount || 0), merged.sourceQueryIds.length);
  merged.status = statusRank(duplicate.status) > statusRank(primary.status) ? duplicate.status : primary.status;
  merged.linkedinUrl = primary.linkedinUrl || duplicate.linkedinUrl;
  merged.currentTitle = primary.currentTitle || duplicate.currentTitle;
  merged.currentCompany = primary.currentCompany || duplicate.currentCompany;
  merged.resolvedLocation = primary.resolvedLocation || duplicate.resolvedLocation;
  merged.yearsAtCurrentRole = primary.yearsAtCurrentRole ?? duplicate.yearsAtCurrentRole;
  merged.importedContactId = primary.importedContactId || duplicate.importedContactId;
  merged.updatedAt = new Date().toISOString();
  merged.artifactRefs = {
    mappedCandidateIds: unique([
      ...(primary.artifactRefs?.mappedCandidateIds || []),
      ...(duplicate.artifactRefs?.mappedCandidateIds || [])
    ]),
    filterDecisionIds: unique([
      ...(primary.artifactRefs?.filterDecisionIds || []),
      ...(duplicate.artifactRefs?.filterDecisionIds || [])
    ]),
    queryIds: merged.sourceQueryIds
  };
  return merged;
}

function remapCandidateReferences(db, removedToKeptId) {
  db.drafts = (db.drafts || []).map((draft) =>
    draft.candidateId && removedToKeptId.has(draft.candidateId)
      ? { ...draft, candidateId: removedToKeptId.get(draft.candidateId), updatedAt: new Date().toISOString() }
      : draft
  );
  db.outreachResearch = (db.outreachResearch || []).map((research) =>
    research.candidateId && removedToKeptId.has(research.candidateId)
      ? { ...research, candidateId: removedToKeptId.get(research.candidateId), updatedAt: new Date().toISOString() }
      : research
  );
}

function recomputeRunSummaries(db) {
  for (const run of db.leadGenRuns || []) {
    const candidates = (db.leadCandidates || []).filter((candidate) => candidate.leadGenRunId === run.id);
    run.summary = {
      ...(run.summary || {}),
      totalCandidates: candidates.length,
      acceptedCandidates: candidates.filter((candidate) => candidate.status === "accepted").length,
      droppedCandidates: candidates.filter((candidate) => candidate.status === "dropped").length,
      needsReviewCandidates: candidates.filter((candidate) => candidate.status === "needs_review").length
    };
    if (Array.isArray(run.queryStats)) {
      run.queryStats = run.queryStats.map((query) => {
        const queryCandidates = candidates.filter((candidate) => (candidate.sourceQueryIds || []).includes(query.vectorId));
        return {
          ...query,
          resultCount: queryCandidates.length,
          uniqueCount: queryCandidates.filter((candidate) => (candidate.sourceQueryIds || []).length <= 1).length,
          overlapCount: queryCandidates.filter((candidate) => (candidate.sourceQueryIds || []).length > 1).length
        };
      });
    }
    if (Array.isArray(run.queryPairOverlaps)) {
      const candidateIds = new Set(candidates.map((candidate) => candidate.identityKey));
      run.queryPairOverlaps = run.queryPairOverlaps
        .map((overlap) => ({
          ...overlap,
          sharedCandidateIds: (overlap.sharedCandidateIds || []).filter((id) => candidateIds.has(id)),
          sharedCount: (overlap.sharedCandidateIds || []).filter((id) => candidateIds.has(id)).length
        }))
        .filter((overlap) => overlap.sharedCount > 0);
    }
  }
}

const db = JSON.parse(await fs.readFile(dbPath, "utf8"));
const groups = new Map();
for (const candidate of db.leadCandidates || []) {
  const nameKey = normalizeName(candidate.fullName);
  if (!nameKey) continue;
  if (!groups.has(nameKey)) groups.set(nameKey, []);
  groups.get(nameKey).push(candidate);
}

const refined = [];
const removedToKeptId = new Map();
let duplicateRowsRemoved = 0;

for (const [nameKey, candidates] of groups) {
  const sorted = candidates.sort((a, b) => score(b) - score(a) || String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  let kept = sorted[0];
  for (const duplicate of sorted.slice(1)) {
    removedToKeptId.set(duplicate.id, kept.id);
    kept = mergeCandidates(kept, duplicate);
    duplicateRowsRemoved += 1;
  }
  refined.push(kept);
}

db.leadCandidates = refined.sort((a, b) => normalizeName(a.fullName).localeCompare(normalizeName(b.fullName)));
remapCandidateReferences(db, removedToKeptId);
recomputeRunSummaries(db);

await fs.writeFile(dbPath, `${JSON.stringify(db, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      totalCandidates: db.leadCandidates.length,
      duplicateRowsRemoved,
      duplicateNamesRemaining: db.leadCandidates.length - new Set(db.leadCandidates.map((candidate) => normalizeName(candidate.fullName))).size
    },
    null,
    2
  )
);
