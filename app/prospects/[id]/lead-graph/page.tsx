import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { WorkspaceTabs } from "@/components/WorkspaceTabs";
import { getProspectById } from "@/lib/data/store";
import { buildLeadGraphPayload } from "@/lib/leadgen/graph";

function nodeColor(type: string, status?: string) {
  if (type === "seed") return "#0f172a";
  if (type === "query") return "#0f766e";
  if (status === "imported") return "#2563eb";
  if (status === "accepted") return "#059669";
  if (status === "needs_review") return "#d97706";
  return "#475569";
}

export default async function LeadGraphPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ runId?: string; node?: string }>;
}) {
  const { id } = await params;
  const query = searchParams ? await searchParams : {};
  const workspace = await getProspectById(id);
  if (!workspace) notFound();

  const runs = workspace.leadGenRuns.slice().sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const selectedRun = runs.find((run) => run.id === query.runId) || runs[0];
  const candidates = selectedRun ? workspace.leadCandidates.filter((candidate) => candidate.leadGenRunId === selectedRun.id) : [];
  const graph = selectedRun ? buildLeadGraphPayload(selectedRun, candidates) : null;
  const nodeById = new Map(graph?.nodes.map((node) => [node.id, node]) || []);
  const selectedNode = query.node ? nodeById.get(query.node) : undefined;
  const selectedCandidate = selectedNode?.candidateId ? candidates.find((candidate) => candidate.id === selectedNode.candidateId) : undefined;
  const selectedQuery = selectedNode?.queryId ? selectedRun?.queryStats?.find((item) => item.vectorId === selectedNode.queryId) : undefined;

  return (
    <AppShell>
      <Link href={`/prospects/${id}`} className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-ink">
        <ArrowLeft size={16} />
        Back to workspace
      </Link>
      <div className="mb-6">
        <p className="text-sm font-bold uppercase tracking-wide text-sentry-700">Lead Graph</p>
        <h1 className="mt-2 text-3xl font-bold text-ink">{workspace.prospect.companyName}</h1>
        <p className="mt-2 max-w-3xl text-slate-600">
          Read-only inspection of which queries surfaced each candidate and where overlap occurred.
        </p>
      </div>
      <WorkspaceTabs prospectId={id} active="lead-graph" />

      {runs.length === 0 ? (
        <section className="surface p-8 text-center text-slate-500">Register a lead-generation run in Candidates before opening the graph.</section>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
          <section className="surface overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-5">
              <div>
                <h2 className="text-lg font-bold text-ink">{selectedRun?.seedPersonName}</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Showing {graph?.displayedCandidateCount || 0} of {graph?.totalCandidateCount || 0} candidates.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {runs.map((run) => (
                  <Link
                    key={run.id}
                    href={`/prospects/${id}/lead-graph?runId=${run.id}`}
                    className={`rounded-md px-3 py-2 text-sm font-semibold ${
                      run.id === selectedRun?.id ? "bg-sentry-700 text-white" : "border border-slate-200 bg-white text-slate-700"
                    }`}
                  >
                    {run.seedPersonName || run.seedCompanyName}
                  </Link>
                ))}
              </div>
            </div>
            {graph ? (
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
                    <Link key={node.id} href={`/prospects/${id}/lead-graph?runId=${selectedRun?.id}&node=${encodeURIComponent(node.id)}`}>
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
            ) : null}
          </section>

          <aside className="grid content-start gap-5">
            <section className="surface p-5">
              <h2 className="text-lg font-bold text-ink">Selection</h2>
              {!selectedNode ? <p className="mt-3 text-sm leading-6 text-slate-500">Select a query or person node to inspect details.</p> : null}
              {selectedCandidate ? (
                <div className="mt-4 grid gap-3 text-sm">
                  <p className="font-bold text-ink">{selectedCandidate.fullName}</p>
                  <p className="text-slate-600">{selectedCandidate.currentTitle || "Unknown role"}</p>
                  <p className="text-slate-600">{selectedCandidate.currentCompany || "Unknown company"}</p>
                  <p className="text-slate-600">{selectedCandidate.resolvedLocation || "Unknown location"}</p>
                  <p className="text-slate-600">Found by {selectedCandidate.overlapCount} distinct queries.</p>
                  <div className="flex flex-wrap gap-1">
                    {(selectedCandidate.sourceQueryNames || selectedCandidate.sourceQueryIds).map((name) => (
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
                {(selectedRun?.queryPairOverlaps || []).slice(0, 8).map((overlap) => (
                  <div key={`${overlap.queryAId}:${overlap.queryBId}`} className="rounded-md bg-slate-50 p-3 text-slate-700">
                    <p className="font-semibold text-ink">{overlap.sharedCount} shared people</p>
                    <p className="mt-1 text-xs">{overlap.queryAId} + {overlap.queryBId}</p>
                  </div>
                ))}
                {(selectedRun?.queryPairOverlaps || []).length === 0 ? <p className="text-slate-500">No pair overlap in this run.</p> : null}
              </div>
            </section>
          </aside>
        </div>
      )}
    </AppShell>
  );
}
