import Link from "next/link";
import { ArrowRight, Filter, Radar, Target, Upload, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { BatchJobStatus } from "@/components/BatchJobStatus";
import { PersistentJobBanner } from "@/components/PersistentJobBanner";
import { PeopleTable } from "@/components/PeopleTable";
import { getCampaigns, getLeadGenRun, getPeopleForLeadGenRun, getPersons } from "@/lib/data/store";

type ToolSurface = {
  kicker: string;
  title: string;
  description: string;
  href: string;
  icon: typeof Radar;
};

const TOOL_SURFACES: ToolSurface[] = [
  {
    kicker: "Discovery",
    title: "Lead discovery operations",
    description:
      "Run seed-based search, recursive expansion, and focused run filtering in a dedicated discovery surface.",
    href: "/lead-discovery",
    icon: Radar
  },
  {
    kicker: "Import",
    title: "Imports and manual entry",
    description:
      "Bring in CSVs or add a single person without mixing those tasks into the directory view.",
    href: "/imports",
    icon: Upload
  },
  {
    kicker: "Campaigns",
    title: "Campaign management",
    description:
      "Create campaigns, review counts, and export grouped lists from a clean coordination page.",
    href: "/campaigns",
    icon: Target
  }
];

export default async function PeoplePage({ searchParams }: { searchParams?: Promise<{ runId?: string; jobId?: string }> }) {
  const query = searchParams ? await searchParams : {};
  const allPeople = await getPersons();
  const activeRun = query.runId ? await getLeadGenRun(query.runId) : null;
  const people = query.runId ? await getPeopleForLeadGenRun(query.runId) : allPeople;
  const campaigns = await getCampaigns();

  const approvedCount = allPeople.filter((p) => p.status === "approved").length;
  const contactedCount = allPeople.filter((p) => p.status === "contacted").length;

  const metrics = [
    {
      label: "People",
      value: allPeople.length,
      description: "Total people currently available in the operational directory."
    },
    {
      label: "Campaigns",
      value: campaigns.length,
      description: "Named groups ready for export, outreach, and deduped list management."
    },
    {
      label: "Approved",
      value: approvedCount,
      description: "People already reviewed and ready to move further down the funnel."
    },
    {
      label: "Contacted",
      value: contactedCount,
      description: "People with completed outbound follow-through tracked in the system."
    }
  ];

  return (
    <AppShell badge="PEOPLE">
      {query.jobId ? <BatchJobStatus jobId={query.jobId} /> : null}
      <PersistentJobBanner />

      {/* Hero / directory header */}
      <section className="surface mb-6 overflow-hidden bg-gradient-to-br from-brand-50 via-white to-white p-7">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-2xl">
            <p className="page-kicker">Operations / Directory</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">People Directory</h1>
            <p className="muted-copy mt-2">
              Keep the working list clean here, then jump into dedicated surfaces for discovery, campaign setup, and
              imports.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/lead-discovery" className="button-primary">
              <Radar size={16} />
              Lead Discovery
            </Link>
            <Link href="/campaigns" className="button-secondary">
              <Target size={16} />
              Campaigns
            </Link>
          </div>
        </div>
      </section>

      {/* Metric cards */}
      <section className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <div key={metric.label} className="metric-card">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{metric.label}</p>
            <p className="mt-2 text-4xl font-semibold tracking-tight text-ink">{metric.value}</p>
            <p className="mt-3 text-xs leading-5 text-slate-500">{metric.description}</p>
          </div>
        ))}
      </section>

      {/* Tool surfaces */}
      <section className="mb-8">
        <p className="page-kicker">Tool surfaces</p>
        <h2 className="mt-1.5 text-xl font-semibold tracking-tight text-ink">Split by workflow, not by one long page</h2>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          {TOOL_SURFACES.map(({ kicker, title, description, href, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="surface group flex flex-col p-6 transition hover:-translate-y-0.5 hover:shadow-lg"
            >
              <div className="flex items-start justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{kicker}</p>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-400 transition group-hover:border-brand-200 group-hover:text-brand-500">
                  <Icon size={16} />
                </span>
              </div>
              <h3 className="mt-4 text-lg font-semibold tracking-tight text-ink">{title}</h3>
              <p className="muted-copy mt-2 flex-1 text-sm">{description}</p>
              <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600">
                Open workspace
                <ArrowRight size={15} className="transition group-hover:translate-x-0.5" />
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* Directory table */}
      <section className="surface p-6">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-md">
            <p className="page-kicker">Directory table</p>
            <h2 className="mt-1.5 text-xl font-semibold tracking-tight text-ink">
              All people in the operating directory
            </h2>
          </div>
          <p className="max-w-sm text-sm leading-6 text-slate-500">
            Use this page for review, search, bulk selection, and record inspection. Move setup actions into the
            dedicated pages above.
          </p>
        </div>

        {query.runId ? (
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <p className="flex items-center gap-2 text-sm text-slate-600">
              <Filter size={14} className="text-sentry-700" />
              Filtered to {people.length} people from {activeRun ? `${activeRun.seedPersonName} · ${activeRun.seedCompanyName}` : "a run"}.
            </p>
            <Link href="/people" className="button-secondary px-3 py-1.5 text-sm">
              <X size={14} />
              Reset Filter
            </Link>
          </div>
        ) : null}

        <PeopleTable people={people} campaigns={campaigns} />
      </section>
    </AppShell>
  );
}
