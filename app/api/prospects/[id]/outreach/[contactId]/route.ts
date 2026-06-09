import { NextResponse } from "next/server";
import { getProspectById } from "@/lib/data/store";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; contactId: string }> }) {
  const { id, contactId } = await params;
  const workspace = await getProspectById(id);
  if (!workspace) return NextResponse.json({ error: "Prospect not found" }, { status: 404 });
  return NextResponse.json({
    research: workspace.outreachResearch
      .filter((item) => item.contactId === contactId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  });
}
