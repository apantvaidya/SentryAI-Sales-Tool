import { NextResponse } from "next/server";
import { getProspectById } from "@/lib/data/store";
import { buildLeadGraphPayload } from "@/lib/leadgen/graph";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; runId: string }> }) {
  const { id, runId } = await params;
  const workspace = await getProspectById(id);
  if (!workspace) return NextResponse.json({ error: "Prospect not found" }, { status: 404 });
  const run = workspace.leadGenRuns.find((item) => item.id === runId);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  const candidates = workspace.leadCandidates.filter((candidate) => candidate.leadGenRunId === run.id);
  return NextResponse.json(buildLeadGraphPayload(run, candidates));
}
