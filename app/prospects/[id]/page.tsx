import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileDown, MailPlus, RefreshCw, UserPlus } from "lucide-react";
import { generateResearchBrief, deleteProspect } from "@/app/actions";
import { ActivityTimeline } from "@/components/ActivityTimeline";
import { AppShell } from "@/components/AppShell";
import { FitScoreBadge } from "@/components/FitScoreBadge";
import { PersonaCard } from "@/components/PersonaCard";
import { ResearchChecklist } from "@/components/ResearchChecklist";
import { getProspectById } from "@/lib/data/store";

export default async function ProspectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspace = await getProspectById(id);
  if (!workspace) notFound();
  const { prospect, personas, contacts, drafts, activities } = workspace;
  const generateResearchBriefAction = generateResearchBrief.bind(null, prospect.id);
  const deleteProspectAction = deleteProspect.bind(null, prospect.id);

  return (
    <AppShell>
      <Link href="/" className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-ink">
        <ArrowLeft size={16} />
        Back to dashboard
      </Link>

      <section className="mb-6 rounded-lg border border-slate-200 bg-white p-6 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-sentry-700">Prospect workspace</p>
            <h1 className="mt-2 text-3xl font-bold text-ink">{prospect.companyName}</h1>
            <p className="mt-2 text-slate-600">
              {[prospect.industry, prospect.segment, prospect.companySize].filter(Boolean).join(" · ") || "Company details can be enriched manually."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FitScoreBadge score={prospect.smartSentryFitScore} />
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold capitalize text-slate-700">{prospect.status}</span>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <form action={generateResearchBriefAction}>
            <button className="button-secondary" type="submit">
              <RefreshCw size={16} />
              Generate Research Brief
            </button>
          </form>
          <Link href={`/prospects/${prospect.id}/contacts`} className="button-secondary">
            <UserPlus size={16} />
            Add Contact
          </Link>
          <Link href={`/prospects/${prospect.id}/drafts`} className="button-secondary">
            <MailPlus size={16} />
            Generate Outreach Draft
          </Link>
          <a href={`/prospects/${prospect.id}/export`} className="button-secondary">
            <FileDown size={16} />
            Export CSV
          </a>
          <form action={deleteProspectAction} className="ml-auto">
            <button className="button-secondary text-red-700 hover:bg-red-50" type="submit">
              Delete
            </button>
          </form>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="grid gap-6">
          <section className="surface p-5">
            <h2 className="text-xl font-bold text-ink">Company Intelligence</h2>
            <p className="mt-3 leading-7 text-slate-700">{prospect.summary || "Generate a research brief to populate company intelligence."}</p>
            {prospect.website ? (
              <a href={prospect.website} target="_blank" className="mt-3 inline-block text-sm font-semibold text-sentry-700">
                {prospect.website}
              </a>
            ) : null}
          </section>

          <section className="surface p-5">
            <h2 className="text-xl font-bold text-ink">Pain Points</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {(prospect.painPoints.length ? prospect.painPoints : ["No pain points generated yet."]).map((point) => (
                <div key={point} className="rounded-md bg-slate-50 p-3 text-sm leading-6 text-slate-700">
                  {point}
                </div>
              ))}
            </div>
          </section>

          <section className="surface p-5">
            <h2 className="text-xl font-bold text-ink">Smart Sentry Fit</h2>
            <p className="mt-3 leading-7 text-slate-700">{prospect.securityRelevance || "Security relevance will appear after research generation."}</p>
            {prospect.fitRationale ? <p className="mt-3 rounded-md bg-sentry-50 p-3 text-sm text-sentry-900">{prospect.fitRationale}</p> : null}
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xl font-bold text-ink">Buyer Personas</h2>
            </div>
            {personas.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-slate-500">
                Generate a research brief to create persona recommendations.
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {personas.map((persona) => (
                  <PersonaCard key={persona.id} persona={persona} />
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="grid content-start gap-5">
          <ResearchChecklist />
          <section className="surface p-5">
            <h2 className="text-lg font-bold text-ink">Contacts</h2>
            <p className="mt-2 text-3xl font-bold text-ink">{contacts.length}</p>
            <p className="text-sm text-slate-500">Manual contacts only. Emails are not considered verified by default.</p>
            <Link href={`/prospects/${prospect.id}/contacts`} className="button-secondary mt-4 w-full">
              Manage Contacts
            </Link>
          </section>
          <section className="surface p-5">
            <h2 className="text-lg font-bold text-ink">Outreach Drafts</h2>
            <p className="mt-2 text-3xl font-bold text-ink">{drafts.length}</p>
            <p className="text-sm text-slate-500">Drafts must be approved before copy/export review.</p>
            <Link href={`/prospects/${prospect.id}/drafts`} className="button-secondary mt-4 w-full">
              Open Drafts
            </Link>
          </section>
          <section className="surface p-5">
            <h2 className="text-lg font-bold text-ink">Activity / Status</h2>
            <div className="mt-4">
              <ActivityTimeline activities={activities} />
            </div>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
