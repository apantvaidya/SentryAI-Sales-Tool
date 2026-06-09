import Link from "next/link";
import { Building2, CheckCircle2, FileText, PlusCircle, Users } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ProspectCard } from "@/components/ProspectCard";
import { getProspects } from "@/lib/data/store";

export default async function DashboardPage() {
  const prospects = await getProspects();
  const activeProspects = prospects.filter((prospect) => prospect.status !== "approved").length;
  const approvedProspects = prospects.filter((prospect) => prospect.status === "approved").length;
  const researchedProspects = prospects.filter((prospect) => prospect.summary).length;

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="page-kicker">Revenue Workspace</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink">Prospect command center</h1>
          <p className="mt-2 max-w-2xl text-slate-600">
            Research target accounts, score buyer relevance, and prepare reviewed outreach without automated sending.
          </p>
        </div>
        <Link href="/prospects/new" className="button-primary">
          <PlusCircle size={18} />
          New Prospect
        </Link>
      </div>

      <section className="mb-6 grid gap-4 md:grid-cols-4">
        <div className="metric-card">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-500">Workspaces</p>
            <Building2 size={18} className="text-slate-500" />
          </div>
          <p className="mt-3 text-3xl font-bold text-ink">{prospects.length}</p>
        </div>
        <div className="metric-card">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-500">Active</p>
            <Users size={18} className="text-slate-500" />
          </div>
          <p className="mt-3 text-3xl font-bold text-ink">{activeProspects}</p>
        </div>
        <div className="metric-card">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-500">Researched</p>
            <FileText size={18} className="text-slate-500" />
          </div>
          <p className="mt-3 text-3xl font-bold text-ink">{researchedProspects}</p>
        </div>
        <div className="metric-card">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-500">Approved</p>
            <CheckCircle2 size={18} className="text-slate-500" />
          </div>
          <p className="mt-3 text-3xl font-bold text-ink">{approvedProspects}</p>
        </div>
      </section>

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
        <section className="surface overflow-hidden ring-1 ring-slate-200">
          <div className="flex items-center justify-between border-b border-slate-300 bg-slate-50/80 px-5 py-4">
            <div>
              <h2 className="section-title">Accounts</h2>
              <p className="muted-copy">Prioritized workspaces for lead generation, evidence review, and outreach approval.</p>
            </div>
          </div>
          <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-3">
            {prospects.map((prospect) => (
              <ProspectCard key={prospect.id} prospect={prospect} />
            ))}
          </div>
        </section>
      )}
    </AppShell>
  );
}
