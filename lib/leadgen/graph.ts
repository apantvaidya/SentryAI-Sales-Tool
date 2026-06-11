import type { LeadCandidate, LeadGenRun } from "@/lib/data/types";

export type LeadGraphNode = {
  id: string;
  type: "seed" | "query" | "person";
  label: string;
  subtitle?: string;
  status?: string;
  x: number;
  y: number;
  candidateId?: string;
  queryId?: string;
};

export type LeadGraphEdge = {
  id: string;
  source: string;
  target: string;
  type: "seed_query" | "query_person";
};

export type LeadGraphPayload = {
  run: LeadGenRun;
  nodes: LeadGraphNode[];
  edges: LeadGraphEdge[];
  displayedCandidateCount: number;
  totalCandidateCount: number;
};

function shortQueryName(value: string) {
  return value.replace(/^same_company_/i, "same company ").replace(/^similar_company_/i, "similar company ").replace(/_/g, " ");
}

export function buildLeadGraphPayload(run: LeadGenRun, candidates: LeadCandidate[], options: { maxPeople?: number } = {}): LeadGraphPayload {
  const maxPeople = options.maxPeople || 80;
  const queryStats = run.queryStats || [];
  const displayedCandidates = candidates
    .slice()
    .sort((a, b) => b.overlapCount - a.overlapCount || a.fullName.localeCompare(b.fullName))
    .slice(0, maxPeople);

  const nodes: LeadGraphNode[] = [
    {
      id: "seed",
      type: "seed",
      label: run.seedPersonName,
      subtitle: [run.seedRole, run.seedCompanyName].filter(Boolean).join(" at "),
      x: 80,
      y: 260
    }
  ];

  const queryYStep = Math.max(70, 520 / Math.max(queryStats.length, 1));
  queryStats.forEach((query, index) => {
    nodes.push({
      id: `query:${query.vectorId}`,
      type: "query",
      label: shortQueryName(query.vectorName),
      subtitle: `${query.resultCount} results · ${query.overlapCount} overlaps`,
      x: 360,
      y: 70 + index * queryYStep,
      queryId: query.vectorId
    });
  });

  const peopleColumns = 4;
  const peopleXStart = 680;
  const peopleYStep = 54;
  displayedCandidates.forEach((candidate, index) => {
    const column = index % peopleColumns;
    const row = Math.floor(index / peopleColumns);
    nodes.push({
      id: `person:${candidate.id}`,
      type: "person",
      label: candidate.fullName,
      subtitle: candidate.currentTitle || candidate.currentCompany,
      status: candidate.status,
      x: peopleXStart + column * 210,
      y: 45 + row * peopleYStep,
      candidateId: candidate.id
    });
  });

  const displayedIds = new Set(displayedCandidates.map((candidate) => candidate.id));
  const edges: LeadGraphEdge[] = [];
  for (const query of queryStats) {
    edges.push({
      id: `seed:${query.vectorId}`,
      source: "seed",
      target: `query:${query.vectorId}`,
      type: "seed_query"
    });
  }
  for (const candidate of displayedCandidates) {
    if (candidate.sourceQueryIds.length <= 2) continue;
    for (const queryId of candidate.sourceQueryIds) {
      if (!displayedIds.has(candidate.id)) continue;
      edges.push({
        id: `${queryId}:${candidate.id}`,
        source: `query:${queryId}`,
        target: `person:${candidate.id}`,
        type: "query_person"
      });
    }
  }

  return {
    run,
    nodes,
    edges,
    displayedCandidateCount: displayedCandidates.length,
    totalCandidateCount: candidates.length
  };
}
