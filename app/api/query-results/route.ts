import { NextResponse } from "next/server";
import { legacyVisualizationPayload } from "@/lib/legacy-visualization/api";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const runId = url.searchParams.get("run_id") || undefined;
  const vectorId = url.searchParams.get("vector_id") || undefined;
  if (!runId || !vectorId) return NextResponse.json({ error: "run_id and vector_id are required" }, { status: 400 });
  try {
    return NextResponse.json(await legacyVisualizationPayload("query_results", { run_id: runId, vector_id: vectorId }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load query results" }, { status: 500 });
  }
}
