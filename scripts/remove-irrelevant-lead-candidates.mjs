import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = path.join(root, "data", "db.json");

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function title(candidate) {
  return normalize(candidate.currentTitle);
}

const relevantRolePattern =
  /\b(asset protection|asset and protection|loss prevention|loss preventon|profit protection|organized retail crime|orc|security|investigator|investigation|safety|ehs|facilities|facility|construction|superintendent|project manager|project director|program manager|site operations|field operations|store operations|retail operations|retail opertions|regional operations|district operations|operations manager|operations director|director of operations|director field operations|field ap operations|district manager|district leader|regional director|regional manager|regional chain director|market manager|area manager|division manager|store manager|store director|store lead|retail manager|grocery manager|chief stores officer|chief operations officer|coo|regional vice president|vice president operations|vp operations|sr vp of retail operations|risk management|supply chain risk|asset compliance|multi district)\b/;

const irrelevantRolePattern =
  /\b(chief executive officer|chief financial officer|chief revenue officer|chief people officer|chief product officer|ceo|cfo|cro|founder|co founder|president|product management|product strategy|talent acquisition|recruiting|clinical|clinician|nurse|psychiatric|psychologo|psicologo|counselor|merchandising|marketing|sales|google cloud|trainer|retired|financial|finance|revenue|people|human resources|technology|architect|software|crm|loyalty|data engineering|salesforce|deal desk|board of directors|flight standards|dealer upfitter|manufacturing engineering)\b/;

function isRelevant(candidate) {
  if (candidate.status === "dropped") return false;
  const role = title(candidate);
  if (!role) return false;
  if (relevantRolePattern.test(role)) return true;
  if (irrelevantRolePattern.test(role)) return false;
  return false;
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
      const candidateKeys = new Set(candidates.map((candidate) => candidate.identityKey));
      run.queryPairOverlaps = run.queryPairOverlaps
        .map((overlap) => {
          const sharedCandidateIds = (overlap.sharedCandidateIds || []).filter((id) => candidateKeys.has(id));
          return { ...overlap, sharedCandidateIds, sharedCount: sharedCandidateIds.length };
        })
        .filter((overlap) => overlap.sharedCount > 0);
    }
  }
}

const db = JSON.parse(await fs.readFile(dbPath, "utf8"));
const before = db.leadCandidates?.length || 0;
const removedIds = new Set();
const removedTitles = new Map();

db.leadCandidates = (db.leadCandidates || []).filter((candidate) => {
  if (isRelevant(candidate)) return true;
  removedIds.add(candidate.id);
  const key = candidate.currentTitle || "<missing>";
  removedTitles.set(key, (removedTitles.get(key) || 0) + 1);
  return false;
});

db.drafts = (db.drafts || []).map((draft) =>
  draft.candidateId && removedIds.has(draft.candidateId)
    ? { ...draft, candidateId: undefined, updatedAt: new Date().toISOString() }
    : draft
);
db.outreachResearch = (db.outreachResearch || []).map((research) =>
  research.candidateId && removedIds.has(research.candidateId)
    ? { ...research, candidateId: undefined, updatedAt: new Date().toISOString() }
    : research
);

recomputeRunSummaries(db);

await fs.writeFile(dbPath, `${JSON.stringify(db, null, 2)}\n`);

const removedTitleSummary = Array.from(removedTitles.entries())
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  .slice(0, 25)
  .map(([role, count]) => ({ role, count }));

console.log(
  JSON.stringify(
    {
      totalCandidatesBefore: before,
      totalCandidatesAfter: db.leadCandidates.length,
      removedCandidates: before - db.leadCandidates.length,
      removedTitleSummary
    },
    null,
    2
  )
);
