import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileDown, Link2, Mail, RefreshCw } from "lucide-react";
import { deletePerson, findEmailForPerson, generateOutreachDraft, scorePerson, updatePerson } from "@/app/actions";
import { AppShell } from "@/components/AppShell";
import { ActivityTimeline } from "@/components/ActivityTimeline";
import { CompanyContextCard } from "@/components/CompanyContextCard";
import { CrimeResearchFeed } from "@/components/CrimeResearchFeed";
import { DraftEditor } from "@/components/DraftEditor";
import { FitScoreBadge } from "@/components/FitScoreBadge";
import { LeadGenProvenance } from "@/components/LeadGenProvenance";
import { PersonaCard } from "@/components/PersonaCard";
import { getCampaigns, getPersonById } from "@/lib/data/store";

export default async function PersonDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getPersonById(id);
  if (!detail) notFound();
  const { person, personas, drafts, activities, outreachResearch } = detail;
  const campaigns = await getCampaigns();
  const campaignName = campaigns.find((c) => c.id === person.campaignId)?.name || "Unknown";

  const updatePersonAction = updatePerson.bind(null, id);
  const deletePersonAction = deletePerson.bind(null, id);
  const scorePersonAction = scorePerson.bind(null, id);
  const findEmailAction = findEmailForPerson.bind(null, id);
  const generateOutreachDraftAction = generateOutreachDraft.bind(null, id);

  return (
    <AppShell>
      <Link href="/people" className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-ink">
        <ArrowLeft size={16} />
        Back to People
      </Link>

      <section className="mb-6 overflow-hidden rounded-lg border border-slate-200/80 bg-white/90 shadow-soft backdrop-blur">
        <div className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="page-kicker">Person</p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink">{person.name}</h1>
              <p className="mt-2 text-slate-600">
                {[person.title, person.companyName].filter(Boolean).join(" · ") || "No title or company set."}
              </p>
              {person.linkedinUrl ? (
                <a
                  href={person.linkedinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-sentry-700 hover:underline"
                >
                  <Link2 size={14} />
                  LinkedIn Profile
                </a>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <FitScoreBadge score={person.confidenceScore} />
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold capitalize text-slate-700">{person.status}</span>
              <span className="rounded-full bg-sentry-50 px-3 py-1 text-xs font-bold text-sentry-800">{campaignName}</span>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <form action={scorePersonAction}>
              <button className="button-secondary" type="submit">
                <RefreshCw size={16} />
                Score Person
              </button>
            </form>
            <form action={findEmailAction}>
              <button className="button-secondary" type="submit" title={person.email ? `Current: ${person.email}` : undefined}>
                <Mail size={16} />
                {person.email ? (person.emailVerified ? "Email Verified" : "Re-find Email") : "Find Email"}
              </button>
            </form>
            <a href={`/people/${id}/export`} className="button-secondary">
              <FileDown size={16} />
              Export CSV
            </a>
            <form action={deletePersonAction} className="ml-auto">
              <button className="button-secondary text-red-700 hover:bg-red-50" type="submit">
                Delete
              </button>
            </form>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="grid gap-6">
          <CompanyContextCard person={person} />

          {personas.length > 0 ? (
            <section>
              <h2 className="mb-3 text-xl font-bold text-ink">Buyer Personas</h2>
              <div className="grid gap-4 lg:grid-cols-2">
                {personas.map((persona) => (
                  <PersonaCard key={persona.id} persona={persona} />
                ))}
              </div>
            </section>
          ) : null}

          <section className="surface p-5">
            <h2 className="text-lg font-bold text-ink">Generate Outreach Draft</h2>
            <form action={generateOutreachDraftAction} className="mt-4 grid gap-3">
              <select className="field" name="personaId" defaultValue="">
                <option value="">Auto-match persona</option>
                {personas.map((persona) => (
                  <option key={persona.id} value={persona.id}>
                    {persona.personaName}
                  </option>
                ))}
              </select>
              <select className="field" name="tone" defaultValue="concise">
                <option value="concise">concise</option>
                <option value="executive">executive</option>
                <option value="technical">technical</option>
                <option value="warm">warm</option>
              </select>
              <textarea className="field min-h-28" name="notes" placeholder="Personalization notes or claims to avoid" />
              <button className="button-primary" type="submit">
                Generate Outreach Draft
              </button>
            </form>
          </section>

          <DraftEditor drafts={drafts} personId={id} />

          <CrimeResearchFeed research={outreachResearch} personId={id} />
        </div>

        <aside className="grid content-start gap-5">
          <section className="surface p-5">
            <h2 className="text-lg font-bold text-ink">Edit Person</h2>
            <form action={updatePersonAction} className="mt-4 grid gap-3">
              <select className="field" name="campaignId" defaultValue={person.campaignId}>
                {campaigns.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.name}
                  </option>
                ))}
              </select>
              <input className="field" name="name" defaultValue={person.name} placeholder="Name" />
              <input className="field" name="title" defaultValue={person.title} placeholder="Title" />
              <input className="field" name="email" type="email" defaultValue={person.email} placeholder="Email" />
              <input className="field" name="linkedinUrl" defaultValue={person.linkedinUrl} placeholder="LinkedIn URL" />
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input name="emailVerified" type="checkbox" defaultChecked={person.emailVerified} />
                Email manually verified
              </label>
              <textarea className="field min-h-20" name="notes" defaultValue={person.notes} placeholder="Notes" />
              <input className="field" name="companyName" defaultValue={person.companyName} placeholder="Company name" />
              <input className="field" name="companyWebsite" defaultValue={person.companyWebsite} placeholder="Company website" />
              <input className="field" name="companyIndustry" defaultValue={person.companyIndustry} placeholder="Industry" />
              <input className="field" name="companySize" defaultValue={person.companySize} placeholder="Company size" />
              <input className="field" name="companySegment" defaultValue={person.companySegment} placeholder="Segment" />
              <textarea className="field min-h-20" name="companyNotes" defaultValue={person.companyNotes} placeholder="Company notes" />
              <button className="button-secondary" type="submit">
                Save Changes
              </button>
            </form>
          </section>

          <LeadGenProvenance person={person} />

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
