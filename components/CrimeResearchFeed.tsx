import { ExternalLink, RefreshCw } from "lucide-react";
import { runPersonOutreach } from "@/app/actions";
import type { OutreachResearch } from "@/lib/data/types";

function recommendationClass(value?: string) {
  if (value === "approve") return "bg-emerald-50 text-emerald-700";
  if (value === "reject") return "bg-red-50 text-red-700";
  return "bg-amber-50 text-amber-700";
}

function statusClass(value: string) {
  if (value === "completed") return "bg-emerald-50 text-emerald-700";
  if (value === "failed") return "bg-red-50 text-red-700";
  return "bg-slate-100 text-slate-600";
}

function renderJsonPreview(value: unknown) {
  const text = JSON.stringify(value, null, 2);
  return text.length > 1200 ? `${text.slice(0, 1200)}...` : text;
}

function renderFailureMessage(errorMessage?: string, stderrSnippet?: string) {
  const text = errorMessage || stderrSnippet;
  if (!text) return null;
  return text.length > 1500 ? `${text.slice(0, 1500)}...` : text;
}

export function CrimeResearchFeed({ research, personId }: { research: OutreachResearch[]; personId: string }) {
  const runResearchAction = runPersonOutreach.bind(null, personId);
  const sorted = research.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <section className="grid gap-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="section-title">Crime Research</h2>
        <form action={runResearchAction}>
          <button className="button-secondary" type="submit">
            <RefreshCw size={15} />
            Run Research
          </button>
        </form>
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-slate-500">
          No outreach research runs have been stored for this person yet.
        </div>
      ) : (
        sorted.map((item) => (
          <article key={item.id} className="surface p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-bold text-ink">{item.role || "Outreach research"}</h3>
                <p className="mt-1 text-sm text-slate-500">{[item.company, item.location].filter(Boolean).join(" · ")}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className={`rounded-md px-3 py-1 text-xs font-bold capitalize ${statusClass(item.status)}`}>{item.status}</span>
                <span className={`rounded-md px-3 py-1 text-xs font-bold capitalize ${recommendationClass(item.validationRecommendation)}`}>
                  {item.validationRecommendation.replace("_", " ")}
                </span>
              </div>
            </div>

            {item.status === "failed" ? (
              <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-4">
                <h4 className="font-bold text-red-800">Pipeline Failed Before Evidence Was Collected</h4>
                <p className="mt-2 text-sm leading-6 text-red-700">
                  The outreach run did not reach public search or draft generation. The error below is the saved failure from the pipeline.
                </p>
                {renderFailureMessage(item.errorMessage, item.stderrSnippet) ? (
                  <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-white p-3 text-xs leading-5 text-red-900">
                    {renderFailureMessage(item.errorMessage, item.stderrSnippet)}
                  </pre>
                ) : null}
              </div>
            ) : null}

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div className="rounded-md bg-slate-50 p-4">
                <h4 className="font-bold text-ink">Evidence Summary</h4>
                <p className="mt-2 text-sm leading-6 text-slate-700">{item.evidenceSummary}</p>
              </div>
              <div className="rounded-md bg-slate-50 p-4">
                <h4 className="font-bold text-ink">Validation</h4>
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs leading-5 text-slate-700">{renderJsonPreview(item.validation)}</pre>
              </div>
            </div>

            <details className="mt-4 rounded-md border border-slate-200 bg-white p-4">
              <summary className="cursor-pointer font-bold text-ink">Queries and Search Results</summary>
              <div className="mt-3 grid gap-4 lg:grid-cols-2">
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-slate-950 p-3 text-xs leading-5 text-slate-100">
                  {renderJsonPreview(item.querySet)}
                </pre>
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-slate-950 p-3 text-xs leading-5 text-slate-100">
                  {renderJsonPreview(item.searchResults)}
                </pre>
              </div>
            </details>

            <div className="mt-4">
              <h4 className="font-bold text-ink">Source URLs</h4>
              {item.sourceUrls.length === 0 ? (
                <p className="mt-2 text-sm text-amber-700">No source URLs were returned. This should remain in human review.</p>
              ) : (
                <div className="mt-2 grid gap-2">
                  {item.sourceUrls.map((url) => (
                    <a key={url} href={url} target="_blank" className="inline-flex items-center gap-2 break-all text-sm font-semibold text-sentry-700">
                      <ExternalLink size={14} />
                      {url}
                    </a>
                  ))}
                </div>
              )}
            </div>
          </article>
        ))
      )}
    </section>
  );
}
