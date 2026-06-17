import { NextResponse } from "next/server";
import { personCsv } from "@/lib/csv";
import { getCampaign, getPersonById } from "@/lib/data/store";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getPersonById(id);
  if (!detail) return new NextResponse("Not found", { status: 404 });
  const campaign = await getCampaign(detail.person.campaignId);
  const csv = personCsv(detail.person, detail.drafts, campaign?.name || "Unknown");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${detail.person.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")}-smart-sentry.csv"`
    }
  });
}
