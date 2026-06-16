import { RefreshCw } from "lucide-react";
import { generatePersonResearchBrief } from "@/app/actions";
import type { Person } from "@/lib/data/types";
import { FitScoreBadge } from "./FitScoreBadge";

export function CompanyContextCard({ person }: { person: Person }) {
  const generateAction = generatePersonResearchBrief.bind(null, person.id);
  return (
    <section className="surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="section-title">Company Intelligence</h2>
          <p className="mt-1 text-sm text-slate-500">
            {[person.companyIndustry, person.companySegment, person.companySize].filter(Boolean).join(" · ") || "Company details can be enriched manually."}
          </p>
        </div>
        <FitScoreBadge score={person.companyFitScore} />
      </div>
      <p className="mt-4 leading-7 text-slate-700">{person.companySummary || "Generate a research brief to populate company intelligence."}</p>
      {person.companyWebsite ? (
        <a href={person.companyWebsite} target="_blank" className="mt-3 inline-block text-sm font-semibold text-sentry-700">
          {person.companyWebsite}
        </a>
      ) : null}

      <div className="mt-5">
        <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">Pain Points</h3>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {(person.companyPainPoints.length ? person.companyPainPoints : ["No pain points generated yet."]).map((point) => (
            <div key={point} className="rounded-md bg-slate-50 p-3 text-sm leading-6 text-slate-700">
              {point}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5">
        <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">Smart Sentry Fit</h3>
        <p className="mt-2 leading-6 text-slate-700">{person.companySecurityRelevance || "Security relevance will appear after research generation."}</p>
        {person.companyFitRationale ? <p className="mt-2 rounded-md bg-sentry-50 p-3 text-sm text-sentry-900">{person.companyFitRationale}</p> : null}
      </div>

      <form action={generateAction} className="mt-5">
        <button className="button-secondary" type="submit">
          <RefreshCw size={16} />
          Generate Research Brief
        </button>
      </form>
    </section>
  );
}
