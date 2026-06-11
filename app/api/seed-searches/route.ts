import { NextResponse } from "next/server";
import { legacyVisualizationPayload } from "@/lib/legacy-visualization/api";

export async function GET() {
  try {
    return NextResponse.json(await legacyVisualizationPayload("seed_searches"));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load seed searches graph" },
      { status: 500 }
    );
  }
}
