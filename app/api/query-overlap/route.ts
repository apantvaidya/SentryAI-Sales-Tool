import { NextResponse } from "next/server";
import { legacyVisualizationPayload } from "@/lib/legacy-visualization/api";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const leftQueryId = url.searchParams.get("left_query_id") || undefined;
  const rightQueryId = url.searchParams.get("right_query_id") || undefined;
  if (!leftQueryId || !rightQueryId) {
    return NextResponse.json({ error: "left_query_id and right_query_id are required" }, { status: 400 });
  }
  try {
    return NextResponse.json(
      await legacyVisualizationPayload("query_overlap", {
        left_query_id: leftQueryId,
        right_query_id: rightQueryId
      })
    );
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load query overlap" }, { status: 500 });
  }
}
