import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { getLeadGenRun, getPeopleForLeadGenRun, getPersonById } from "@/lib/data/store";
import { buildLeadGraphPayload } from "@/lib/leadgen/graph";

function nodeColor(type: string, status?: string) {
  if (type === "seed") return "#0f172a";
  if (type === "query") return "#0f766e";
  if (status === "approved" || status === "contacted") return "#2563eb";
  if (status === "drafting") return "#059669";
  if (status === "candidate") return "#d97706";
  return "#475569";
}

export default async function LeadGraphPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ node?: string }>;
}) {
  const { id } = await params;
  const query = searchParams ? await searchParams : {};
  const detail = await getPersonById(id);
  if (!detail || !detail.person.leadGenRunId) notFound();

  const run = await getLeadGenRun(detail.person.leadGenRunId);
  if (!run) notFound();
  const candidates = await getPeopleForLeadGenRun(run.id);
  const graph = buildLeadGraphPayload(run, candidates);
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const selectedNode = query.node ? nodeById.get(query.node) : undefined;
  const selectedCandidate = selectedNode?.candidateId ? candidates.find((candidate) => candidate.id === selectedNode.candidateId) : undefined;
  const selectedQuery = selectedNode?.queryId ? run.queryStats?.find((item) => item.vectorId === selectedNode.queryId) : undefined;

  return (
    <AppShell>
      <Link href={`/people/${id}`} className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-ink">
        <ArrowLeft size={16} />
        Back to person
      </Link>
      <div className="mb-6">
        <p className="text-sm font-bold uppercase tracking-wide text-sentry-700">Lead Graph</p>
        <h1 className="mt-2 text-3xl font-bold text-ink">{run.seedPersonName}</h1>
        <p className="mt-2 max-w-3xl text-slate-600">
          Read-only inspection of which queries surfaced each candidate and where overlap occurred.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <section className="surface overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-5">
            <div>
              <h2 className="text-lg font-bold text-ink">{run.seedPersonName}</h2>
              <p className="mt-1 text-sm text-slate-500">
                Showing {graph.displayedCandidateCount} of {graph.totalCandidateCount} candidates.
              </p>
            </div>
          </div>
          <div className="overflow-auto bg-white">
            <svg width="1500" height="680" role="img" aria-label="Read-only lead generation graph">
              {graph.edges.map((edge) => {
                const source = nodeById.get(edge.source);
                const target = nodeById.get(edge.target);
                if (!source || !target) return null;
                return (
                  <line
                    key={edge.id}
                    x1={source.x}
                    y1={source.y}
                    x2={target.x}
                    y2={target.y}
                    stroke={edge.type === "seed_query" ? "#94a3b8" : "#cbd5e1"}
                    strokeWidth={edge.type === "seed_query" ? 2 : 1}
                  />
                );
              })}
              {graph.nodes.map((node) => (
                <Link key={node.id} href={`/people/${id}/lead-graph?node=${encodeURIComponent(node.id)}`}>
                  <g>
                    <circle cx={node.x} cy={node.y} r={node.type === "person" ? 11 : 18} fill={nodeColor(node.type, node.status)} />
                    <text x={node.x + 18} y={node.y - 3} fontSize="12" fontWeight="700" fill="#172033">
                      {node.label.slice(0, 26)}
                    </text>
                    {node.subtitle ? (
                      <text x={node.x + 18} y={node.y + 13} fontSize="10" fill="#64748b">
                        {node.subtitle.slice(0, 34)}
                      </text>
                    ) : null}
                  </g>
                </Link>
              ))}
            </svg>
          </div>
        </section>

        <aside className="grid content-start gap-5">
          <section className="surface p-5">
            <h2 className="text-lg font-bold text-ink">Selection</h2>
            {!selectedNode ? <p className="mt-3 text-sm leading-6 text-slate-500">Select a query or person node to inspect details.</p> : null}
            {selectedCandidate ? (
              <div className="mt-4 grid gap-3 text-sm">
                <Link href={`/people/${selectedCandidate.id}`} className="font-bold text-sentry-700 hover:underline">
                  {selectedCandidate.name}
                </Link>
                <p className="text-slate-600">{selectedCandidate.title || "Unknown role"}</p>
                <p className="text-slate-600">{selectedCandidate.companyName || "Unknown company"}</p>
                <p className="text-slate-600">{selectedCandidate.location || "Unknown location"}</p>
                <p className="text-slate-600">Found by {selectedCandidate.overlapCount ?? 0} distinct queries.</p>
                <div className="flex flex-wrap gap-1">
                  {(selectedCandidate.sourceQueryNames || selectedCandidate.sourceQueryIds || []).map((name) => (
                    <span key={name} className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700">
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            {selectedQuery ? (
              <div className="mt-4 grid gap-3 text-sm">
                <p className="font-bold text-ink">{selectedQuery.vectorName}</p>
                <p className="text-slate-600">{selectedQuery.resultCount} candidates found.</p>
                <p className="text-slate-600">{selectedQuery.uniqueCount} unique to this query.</p>
                <p className="text-slate-600">{selectedQuery.overlapCount} overlapped with another query.</p>
              </div>
            ) : null}
          </section>
          <section className="surface p-5">
            <h2 className="text-lg font-bold text-ink">Query Overlap</h2>
            <div className="mt-4 grid gap-2 text-sm">
              {(run.queryPairOverlaps || []).slice(0, 8).map((overlap) => (
                <div key={`${overlap.queryAId}:${overlap.queryBId}`} className="rounded-md bg-slate-50 p-3 text-slate-700">
                  <p className="font-semibold text-ink">{overlap.sharedCount} shared people</p>
                  <p className="mt-1 text-xs">{overlap.queryAId} + {overlap.queryBId}</p>
                </div>
              ))}
              {(run.queryPairOverlaps || []).length === 0 ? <p className="text-slate-500">No pair overlap in this run.</p> : null}
            </div>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
