import Link from "next/link";
import { Building2, Clock3 } from "lucide-react";
import type { Prospect } from "@/lib/data/types";
import { formatDate } from "@/lib/utils";
import { FitScoreBadge } from "./FitScoreBadge";

export function ProspectCard({ prospect }: { prospect: Prospect }) {
  return (
    <Link href={`/prospects/${prospect.id}`} className="surface block p-5 transition hover:-translate-y-0.5 hover:border-sentry-500">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-md bg-slate-100 text-slate-700">
            <Building2 size={20} />
          </span>
          <div>
            <h2 className="text-lg font-bold text-ink">{prospect.companyName}</h2>
            <p className="mt-1 text-sm text-slate-500">{prospect.industry || prospect.segment || "Industry not set"}</p>
          </div>
        </div>
        <FitScoreBadge score={prospect.smartSentryFitScore} />
      </div>
      <p className="mt-4 line-clamp-2 min-h-10 text-sm leading-5 text-slate-600">
        {prospect.summary || "Research brief has not been generated yet."}
      </p>
      <div className="mt-5 flex items-center justify-between text-xs font-medium text-slate-500">
        <span className="rounded-full bg-slate-100 px-2 py-1 capitalize">{prospect.status}</span>
        <span className="flex items-center gap-1">
          <Clock3 size={14} />
          {formatDate(prospect.updatedAt)}
        </span>
      </div>
    </Link>
  );
}
