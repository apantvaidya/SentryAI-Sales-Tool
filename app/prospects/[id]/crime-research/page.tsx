import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, RefreshCw } from "lucide-react";
import { runContactOutreach } from "@/app/actions";
import { AppShell } from "@/components/AppShell";
import { WorkspaceTabs } from "@/components/WorkspaceTabs";
import { getProspectById } from "@/lib/data/store";

function recommendationClass(value?: string) {
  if (value === "approve") return "bg-emerald-50 text-emerald-700";
  if (value === "reject") return "bg-red-50 text-red-700";
  return "bg-amber-50 text-amber-700";
}

function renderJsonPreview(value: unknown) {
  const text = JSON.stringify(value, null, 2);
  return text.length > 1200 ? `${text.slice(0, 1200)}...` : text;
}

export default async function CrimeResearchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspace = await getProspectById(id);
  if (!workspace) notFound();
  const contactById = new Map(workspace.contacts.map((contact) => [contact.id, contact]));
  const candidateById = new Map(workspace.leadCandidates.map((candidate) => [candidate.id, candidate]));
  const researchRuns = workspace.outreachResearch.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <AppShell>
      <Link href={`/prospects/${id}`} className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-ink">
        <ArrowLeft size={16} />
        Back to workspace
      </Link>
      <div className="mb-6">
        <p className="text-sm font-bold uppercase tracking-wide text-sentry-700">Crime Research</p>
        <h1 className="mt-2 text-3xl font-bold text-ink">{workspace.prospect.companyName}</h1>
        <p className="mt-2 max-w-3xl text-slate-600">
          Review the exact public evidence, generated queries, validation status, and linked outreach drafts before approval.
        </p>
      </div>
      <WorkspaceTabs prospectId={id} active="crime-research" />

      <div className="grid gap-6 xl:grid-cols-[340px_1fr]">
        <aside className="surface grid content-start gap-4 p-5">
          <h2 className="text-lg font-bold text-ink">Run Outreach</h2>
          <p className="text-sm leading-6 text-slate-500">Run or rerun evidence-backed outreach for one imported contact.</p>
          {workspace.contacts.length === 0 ? <p className="text-sm text-amber-700">Import a candidate as a contact first.</p> : null}
          {workspace.contacts.map((contact) => (
            <form key={contact.id} action={runContactOutreach.bind(null, id, contact.id)} className="rounded-md border border-slate-200 bg-white p-3">
              <p className="font-semibold text-ink">{contact.name || contact.title}</p>
              <p className="mt-1 text-sm text-slate-500">{contact.title}</p>
              <button className="button-secondary mt-3 w-full" type="submit">
                <RefreshCw size={15} />
                Run Research
              </button>
            </form>
          ))}
        </aside>

        <section className="grid gap-5">
          {researchRuns.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-slate-500">
              No outreach research runs have been stored for this prospect yet.
            </div>
          ) : (
            researchRuns.map((research) => {
              const contact = contactById.get(research.contactId);
              const candidate = research.candidateId ? candidateById.get(research.candidateId) : undefined;
              const linkedDraft = workspace.drafts.find((draft) => draft.outreachResearchId === research.id);
              return (
                <article key={research.id} className="surface p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{contact?.name || "Unknown contact"}</p>
                      <h2 className="mt-1 text-xl font-bold text-ink">{research.role || contact?.title || "Outreach research"}</h2>
                      <p className="mt-1 text-sm text-slate-500">
                        {[research.company, research.location, candidate?.fullName].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <span className={`rounded-md px-3 py-1 text-xs font-bold capitalize ${recommendationClass(research.validationRecommendation)}`}>
                      {research.validationRecommendation.replace("_", " ")}
                    </span>
                  </div>

                  <div className="mt-5 grid gap-4 lg:grid-cols-2">
                    <div className="rounded-md bg-slate-50 p-4">
                      <h3 className="font-bold text-ink">Evidence Summary</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-700">{research.evidenceSummary}</p>
                    </div>
                    <div className="rounded-md bg-slate-50 p-4">
                      <h3 className="font-bold text-ink">Validation</h3>
                      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs leading-5 text-slate-700">{renderJsonPreview(research.validation)}</pre>
                    </div>
                  </div>

                  <details className="mt-4 rounded-md border border-slate-200 bg-white p-4">
                    <summary className="cursor-pointer font-bold text-ink">Queries and Search Results</summary>
                    <div className="mt-3 grid gap-4 lg:grid-cols-2">
                      <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-slate-950 p-3 text-xs leading-5 text-slate-100">
                        {renderJsonPreview(research.querySet)}
                      </pre>
                      <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-slate-950 p-3 text-xs leading-5 text-slate-100">
                        {renderJsonPreview(research.searchResults)}
                      </pre>
                    </div>
                  </details>

                  <div className="mt-4">
                    <h3 className="font-bold text-ink">Source URLs</h3>
                    {research.sourceUrls.length === 0 ? (
                      <p className="mt-2 text-sm text-amber-700">No source URLs were returned. This should remain in human review.</p>
                    ) : (
                      <div className="mt-2 grid gap-2">
                        {research.sourceUrls.map((url) => (
                          <a key={url} href={url} target="_blank" className="inline-flex items-center gap-2 break-all text-sm font-semibold text-sentry-700">
                            <ExternalLink size={14} />
                            {url}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="mt-5 flex flex-wrap gap-2">
                    {linkedDraft ? (
                      <Link href={`/prospects/${id}/drafts`} className="button-secondary">
                        View Linked Draft
                      </Link>
                    ) : null}
                    {contact ? (
                      <form action={runContactOutreach.bind(null, id, contact.id)}>
                        <button className="button-secondary" type="submit">
                          <RefreshCw size={15} />
                          Rerun
                        </button>
                      </form>
                    ) : null}
                  </div>
                </article>
              );
            })
          )}
        </section>
      </div>
    </AppShell>
  );
}
