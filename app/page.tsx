import Link from "next/link";
import { PlusCircle } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ProspectCard } from "@/components/ProspectCard";
import { getProspects } from "@/lib/data/store";

export default async function DashboardPage() {
  const prospects = await getProspects();

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-bold uppercase tracking-wide text-sentry-700">Dashboard</p>
          <h1 className="mt-2 text-3xl font-bold text-ink">Prospect workspaces</h1>
          <p className="mt-2 max-w-2xl text-slate-600">
            Research target accounts, score buyer relevance, and prepare reviewed outreach without automated sending.
          </p>
        </div>
        <Link href="/prospects/new" className="button-primary">
          <PlusCircle size={18} />
          New Prospect
        </Link>
      </div>

      {prospects.length === 0 ? (
        <section className="surface flex min-h-80 flex-col items-center justify-center p-8 text-center">
          <h2 className="text-2xl font-bold text-ink">Start with one target account</h2>
          <p className="mt-2 max-w-lg text-slate-600">
            Add a company name, optional website, segment, and notes. The app will generate a research brief and buyer personas in demo mode or with your OpenAI key.
          </p>
          <Link href="/prospects/new" className="button-primary mt-6">
            Generate Research Brief
          </Link>
        </section>
      ) : (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {prospects.map((prospect) => (
            <ProspectCard key={prospect.id} prospect={prospect} />
          ))}
        </section>
      )}
    </AppShell>
  );
}
