import { NextResponse } from "next/server";
import { getProspectById } from "@/lib/data/store";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; runId: string }> }) {
  const { id, runId } = await params;
  const workspace = await getProspectById(id);
  if (!workspace) return NextResponse.json({ error: "Prospect not found" }, { status: 404 });
  return NextResponse.json({
    candidates: workspace.leadCandidates.filter((candidate) => candidate.leadGenRunId === runId)
  });
}
