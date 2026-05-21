import { NextResponse } from "next/server";
import { prospectWorkspaceCsv } from "@/lib/csv";
import { getProspectById } from "@/lib/data/store";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspace = await getProspectById(id);
  if (!workspace) return new NextResponse("Not found", { status: 404 });
  const csv = prospectWorkspaceCsv(workspace);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${workspace.prospect.companyName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")}-smart-sentry.csv"`
    }
  });
}
