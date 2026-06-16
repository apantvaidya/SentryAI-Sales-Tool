import { promises as fs } from "fs";
import path from "path";
import type { CandidateIdentityKeyType, LeadGenRun, LeadQueryStats, Person, QueryPairOverlap } from "@/lib/data/types";
import { candidateIdentity } from "./identity";

const dataRoot = path.join(process.cwd(), "lead_generation_mod", "data");
const runsRoot = path.join(dataRoot, "runs");
const importerVersion = "leadgen-import-v1" as const;

export type ArtifactCandidateStatus = "accepted" | "dropped" | "needs_review" | "imported";

export type ArtifactCandidate = {
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
  status: ArtifactCandidateStatus;
  artifactRefs: Person["artifactRefs"];
};

type QueryArtifact = {
  vector_id: string;
  vector_name: string;
  target_bucket?: string;
};

type FilterDecisionArtifact = {
  status: ArtifactCandidateStatus;
  reasons?: string[];
  candidate: {
    full_name?: string;
    current_title?: string;
    current_company?: string;
    years_at_current_role?: number;
    resolved_location?: string;
    linkedin_url?: string;
    source_vector_id: string;
    source_vector_name: string;
    source_bucket?: string;
    exa_result_id?: string;
    exa_entity_id?: string;
  };
};

function clean(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

export async function listArtifactRunIds() {
  try {
    const entries = await fs.readdir(runsRoot, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse();
  } catch {
    return [];
  }
}

export async function importLeadGenArtifacts(artifactRunId: string) {
  const runDir = path.join(runsRoot, artifactRunId);
  const [queries, filterDecisions, batch, runSummary] = await Promise.all([
    readJson<QueryArtifact[]>(path.join(runDir, "queries.json")),
    readJson<FilterDecisionArtifact[]>(path.join(runDir, "filter_decisions.json")),
    readJson<{ seed_person: { person_name: string; role?: string; company_name: string; linkedin_url?: string } }>(path.join(runDir, "batch.json")),
    readJson<Record<string, number | string | boolean | null>>(path.join(runDir, "run_summary.json"))
  ]);

  const queryById = new Map(queries.map((query) => [query.vector_id, query]));
  const personByIdentity = new Map<
    string,
    {
      base: ArtifactCandidate;
      queryIds: Set<string>;
      queryNames: Set<string>;
      buckets: Set<string>;
      statuses: Set<ArtifactCandidateStatus>;
      mappedRefs: Set<string>;
      filterRefs: Set<string>;
    }
  >();

  filterDecisions.forEach((decision, index) => {
    const candidate = decision.candidate;
    const fullName = clean(candidate.full_name);
    const currentCompany = clean(candidate.current_company);
    if (!fullName) return;

    const identity = candidateIdentity({
      linkedinUrl: candidate.linkedin_url,
      fullName,
      currentCompany
    });
    if (!identity.identityKey || identity.identityKey === "::") return;

    const existing = personByIdentity.get(identity.identityKey);
    const sourceVectorId = candidate.source_vector_id;
    const sourceVectorName = candidate.source_vector_name || queryById.get(sourceVectorId)?.vector_name || sourceVectorId;
    const status = decision.status || "needs_review";

    if (!existing) {
      personByIdentity.set(identity.identityKey, {
        base: {
          identityKey: identity.identityKey,
          identityKeyType: identity.identityKeyType,
          linkedinUrl: clean(candidate.linkedin_url),
          fullName,
          currentTitle: clean(candidate.current_title),
          currentCompany,
          resolvedLocation: clean(candidate.resolved_location),
          yearsAtCurrentRole: candidate.years_at_current_role,
          sourceQueryIds: [],
          sourceQueryNames: [],
          sourceBuckets: [],
          overlapCount: 0,
          status,
          artifactRefs: {
            mappedCandidateIds: [],
            filterDecisionIds: [],
            queryIds: []
          }
        },
        queryIds: new Set(),
        queryNames: new Set(),
        buckets: new Set(),
        statuses: new Set(),
        mappedRefs: new Set(),
        filterRefs: new Set()
      });
    }

    const record = personByIdentity.get(identity.identityKey)!;
    record.queryIds.add(sourceVectorId);
    record.queryNames.add(sourceVectorName);
    if (candidate.source_bucket) record.buckets.add(candidate.source_bucket);
    record.statuses.add(status);
    if (candidate.exa_entity_id) record.mappedRefs.add(candidate.exa_entity_id);
    if (candidate.exa_result_id) record.mappedRefs.add(candidate.exa_result_id);
    record.filterRefs.add(String(index));
  });

  const statusPriority: Record<ArtifactCandidateStatus, number> = {
    imported: 4,
    accepted: 3,
    needs_review: 2,
    dropped: 1
  };

  const candidates = Array.from(personByIdentity.values()).map((record) => {
    const sourceQueryIds = Array.from(record.queryIds).sort();
    const statuses = Array.from(record.statuses);
    const status = statuses.sort((a, b) => statusPriority[b] - statusPriority[a])[0] || "needs_review";
    return {
      ...record.base,
      sourceQueryIds,
      sourceQueryNames: Array.from(record.queryNames).sort(),
      sourceBuckets: Array.from(record.buckets).sort(),
      overlapCount: sourceQueryIds.length,
      status,
      artifactRefs: {
        mappedCandidateIds: Array.from(record.mappedRefs).sort(),
        filterDecisionIds: Array.from(record.filterRefs).sort(),
        queryIds: sourceQueryIds
      }
    };
  });

  const candidatesByQuery = new Map<string, Set<string>>();
  for (const query of queries) {
    candidatesByQuery.set(query.vector_id, new Set());
  }
  for (const candidate of candidates) {
    for (const queryId of candidate.sourceQueryIds) {
      candidatesByQuery.get(queryId)?.add(candidate.identityKey);
    }
  }

  const queryStats: LeadQueryStats[] = queries.map((query) => {
    const identities = candidatesByQuery.get(query.vector_id) || new Set<string>();
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

  const queryPairOverlaps: QueryPairOverlap[] = [];
  for (let leftIndex = 0; leftIndex < queries.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < queries.length; rightIndex += 1) {
      const left = queries[leftIndex];
      const right = queries[rightIndex];
      const leftSet = candidatesByQuery.get(left.vector_id) || new Set<string>();
      const rightSet = candidatesByQuery.get(right.vector_id) || new Set<string>();
      const sharedKeys = Array.from(leftSet).filter((identityKey) => rightSet.has(identityKey));
      if (sharedKeys.length === 0) continue;
      queryPairOverlaps.push({
        queryAId: left.vector_id,
        queryBId: right.vector_id,
        sharedCandidateIds: sharedKeys,
        sharedCount: sharedKeys.length
      });
    }
  }

  const acceptedCandidates = candidates.filter((candidate) => candidate.status === "accepted").length;
  const droppedCandidates = candidates.filter((candidate) => candidate.status === "dropped").length;
  const needsReviewCandidates = candidates.filter((candidate) => candidate.status === "needs_review").length;

  const run: Omit<LeadGenRun, "id" | "createdAt" | "updatedAt"> = {
    seedPersonName: batch.seed_person.person_name,
    seedRole: clean(batch.seed_person.role),
    seedCompanyName: batch.seed_person.company_name,
    seedLinkedinUrl: clean(batch.seed_person.linkedin_url),
    status: "completed",
    artifactRunId,
    artifactPath: runDir,
    importerVersion,
    completedAt: new Date().toISOString(),
    summary: {
      totalCandidates: candidates.length,
      acceptedCandidates,
      droppedCandidates,
      needsReviewCandidates
    },
    queryStats,
    queryPairOverlaps,
    stdoutSnippet: typeof runSummary.status === "string" ? runSummary.status : undefined
  };

  return { run, candidates };
}
