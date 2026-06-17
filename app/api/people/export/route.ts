import { NextResponse } from "next/server";
import { peopleCsv } from "@/lib/csv";
import { getCampaigns, getPersonById, getPersonsForCampaigns } from "@/lib/data/store";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ids = (searchParams.get("ids") || "").split(",").map((id) => id.trim()).filter(Boolean);
  const campaignIds = (searchParams.get("campaignIds") || "").split(",").map((id) => id.trim()).filter(Boolean);

  const campaigns = await getCampaigns();
  const campaignNameById = new Map(campaigns.map((c) => [c.id, c.name]));

  if (campaignIds.length > 0) {
    const results = await getPersonsForCampaigns(campaignIds);
    const rows = results.map(({ person, drafts }) => {
      const latestDraft = drafts.slice().sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
      return { person, draft: latestDraft, campaignName: campaignNameById.get(person.campaignId) || "Unknown" };
    });
    if (rows.length === 0) return new NextResponse("No people found in selected campaigns", { status: 400 });
    const campaignLabel =
      campaignIds.length === 1
        ? (campaigns.find((c) => c.id === campaignIds[0])?.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "campaign")
        : `${campaignIds.length}-campaigns`;
    const csv = peopleCsv(rows);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${campaignLabel}-export-${rows.length}.csv"`
      }
    });
  }

  if (ids.length === 0) return new NextResponse("No people selected", { status: 400 });
  const details = await Promise.all(ids.map((id) => getPersonById(id)));
  const rows = details
    .filter((detail): detail is NonNullable<typeof detail> => Boolean(detail))
    .map((detail) => {
      const latestDraft = detail.drafts.slice().sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
      return { person: detail.person, draft: latestDraft, campaignName: campaignNameById.get(detail.person.campaignId) || "Unknown" };
    });
  const csv = peopleCsv(rows);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="people-export-${rows.length}.csv"`
    }
  });
}
