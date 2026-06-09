import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileDown } from "lucide-react";
import { generateOutreachDraft } from "@/app/actions";
import { AppShell } from "@/components/AppShell";
import { DraftEditor } from "@/components/DraftEditor";
import { ResearchChecklist } from "@/components/ResearchChecklist";
import { WorkspaceTabs } from "@/components/WorkspaceTabs";
import { getProspectById } from "@/lib/data/store";

export default async function DraftsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspace = await getProspectById(id);
  if (!workspace) notFound();
  const generateOutreachDraftAction = generateOutreachDraft.bind(null, id);

  return (
    <AppShell>
      <Link href={`/prospects/${id}`} className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-ink">
        <ArrowLeft size={16} />
        Back to workspace
      </Link>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-bold uppercase tracking-wide text-sentry-700">Outreach Drafts</p>
          <h1 className="mt-2 text-3xl font-bold text-ink">{workspace.prospect.companyName}</h1>
          <p className="mt-2 max-w-2xl text-slate-600">
            Generate persona-specific drafts, edit them, approve manually, then copy or export.
          </p>
        </div>
        <a className="button-secondary" href={`/prospects/${id}/export`}>
          <FileDown size={16} />
          Export CSV
        </a>
      </div>
      <WorkspaceTabs prospectId={id} active="drafts" />

      <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
        <aside className="grid content-start gap-5">
          <form action={generateOutreachDraftAction} className="surface grid gap-4 p-5">
            <h2 className="text-lg font-bold text-ink">Generate Outreach Draft</h2>
            <select className="field" name="contactId" defaultValue="">
              <option value="">Select contact</option>
              {workspace.contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.name || contact.title} · {contact.title}
                </option>
              ))}
            </select>
            <select className="field" name="personaId" defaultValue="">
              <option value="">Auto-match persona</option>
              {workspace.personas.map((persona) => (
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
            {workspace.contacts.length === 0 ? <p className="text-xs text-amber-700">Add a contact first for the strongest personalization.</p> : null}
          </form>
          <ResearchChecklist />
        </aside>
        <section>
          <DraftEditor drafts={workspace.drafts} contacts={workspace.contacts} prospectId={id} />
        </section>
      </div>
    </AppShell>
  );
}
