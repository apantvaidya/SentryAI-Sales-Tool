import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createContact } from "@/app/actions";
import { AppShell } from "@/components/AppShell";
import { ContactTable } from "@/components/ContactTable";
import { WorkspaceTabs } from "@/components/WorkspaceTabs";
import { getProspectById } from "@/lib/data/store";

export default async function ContactsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspace = await getProspectById(id);
  if (!workspace) notFound();
  const createContactAction = createContact.bind(null, id);

  return (
    <AppShell>
      <Link href={`/prospects/${id}`} className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-ink">
        <ArrowLeft size={16} />
        Back to workspace
      </Link>
      <div className="mb-6">
        <p className="text-sm font-bold uppercase tracking-wide text-sentry-700">Contacts</p>
        <h1 className="mt-2 text-3xl font-bold text-ink">{workspace.prospect.companyName}</h1>
        <p className="mt-2 max-w-2xl text-slate-600">
          Add likely decision-makers manually. The app scores relevance, but email verification must be confirmed by the user.
        </p>
      </div>
      <WorkspaceTabs prospectId={id} active="contacts" />

      <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
        <form action={createContactAction} className="surface grid content-start gap-4 p-5">
          <h2 className="text-lg font-bold text-ink">Add Contact</h2>
          <input className="field" name="name" placeholder="Name" />
          <input className="field" name="title" placeholder="Title" required />
          <input className="field" name="email" type="email" placeholder="Email, unverified" />
          <input className="field" name="linkedinUrl" type="url" placeholder="LinkedIn URL" />
          <input className="field" name="source" placeholder="Source, e.g. manual research" defaultValue="Manual" />
          <textarea className="field min-h-28" name="notes" placeholder="Notes, relevance hints, verification status" />
          <button className="button-primary" type="submit">
            Add Contact
          </button>
          <p className="text-xs leading-5 text-slate-500">No hidden scraping or automated enrichment runs in this MVP.</p>
        </form>

        <section>
          <ContactTable contacts={workspace.contacts} prospectId={id} />
        </section>
      </div>
    </AppShell>
  );
}
