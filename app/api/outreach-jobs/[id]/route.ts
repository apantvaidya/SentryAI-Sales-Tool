import { NextResponse } from "next/server";
import { getOutreachJob } from "@/lib/data/store";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getOutreachJob(id);
  if (!job) return new NextResponse("Not found", { status: 404 });
  return NextResponse.json(job);
}
