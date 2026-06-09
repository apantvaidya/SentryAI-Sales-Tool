import { NextResponse } from "next/server";
import { legacyVisualizationPayload } from "@/lib/legacy-visualization/api";

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    return NextResponse.json(await legacyVisualizationPayload("graph", { run_id: url.searchParams.get("run_id") || undefined }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load graph" }, { status: 500 });
  }
}
