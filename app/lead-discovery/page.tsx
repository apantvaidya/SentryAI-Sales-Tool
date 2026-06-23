import { Filter } from "lucide-react";
import { createLeadGenRun, registerExistingLeadGenRun } from "@/app/actions";
import { AppShell } from "@/components/AppShell";
import { PendingButton } from "@/components/PendingButton";
import { PersistentJobBanner } from "@/components/PersistentJobBanner";
import { getCampaigns } from "@/lib/data/store";
import { listArtifactRuns } from "@/lib/leadgen/import";

export default async function LeadDiscoveryPage() {
  const campaigns = await getCampaigns();
  const artifactRuns = await listArtifactRuns();

  return (
    <AppShell badge="DISCOVERY">
      <section className="surface mb-6 overflow-hidden bg-gradient-to-br from-brand-50 via-white to-white p-7">
        <p className="page-kicker">Operations / Discovery</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">Lead discovery operations</h1>
        <p className="muted-copy mt-2 max-w-2xl">
          Run seed-based search, recursive expansion, and focused run filtering in a dedicated discovery surface.
        </p>
      </section>

      <PersistentJobBanner />

      <div className="grid gap-4 md:grid-cols-2">
        <form action={createLeadGenRun} className="surface grid gap-3 p-6 content-start">
          <div>
            <h2 className="section-title">Find People</h2>
            <p className="muted-copy mt-1">Start from a seed profile and import the resulting candidates.</p>
          </div>
          <input className="field" name="seedPersonName" placeholder="Seed person name" required />
          <input className="field" name="seedRole" placeholder="Seed role" />
          <input className="field" name="seedCompanyName" placeholder="Seed company" required />
          <input className="field" name="seedLinkedinUrl" placeholder="Seed LinkedIn URL" />
          <select className="field" name="campaignId" defaultValue={campaigns[0]?.id || ""} required>
            {campaigns.length === 0 ? <option value="">No campaigns found</option> : null}
            {campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name}
              </option>
            ))}
          </select>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <label className="flex items-start gap-2 text-sm font-semibold text-slate-700">
              <input className="mt-0.5 h-4 w-4 rounded border-slate-300" type="checkbox" name="recursiveExpansion" />
              <span>
                Recursive expansion
                <span className="mt-1 block text-xs font-normal leading-5 text-slate-500">
                  Pivot from each run into a similar-company lead and repeat until the target lead count is reached.
                </span>
              </span>
            </label>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="grid gap-1 text-xs font-semibold text-slate-600">
                Target total leads
                <input className="field" name="targetTotal" type="number" min={1} placeholder="100" defaultValue={100} />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-600">
                Max hops
                <input className="field" name="maxHops" type="number" min={1} placeholder="20" defaultValue={20} />
              </label>
            </div>
          </div>
          <PendingButton className="button-primary" disabled={campaigns.length === 0} pendingText="Running… (may take several minutes)">
            Run Exa Lead Gen
          </PendingButton>
        </form>

        <form action={registerExistingLeadGenRun} className="surface grid gap-3 p-6 content-start">
          <div>
            <h2 className="section-title">Filter by Run</h2>
            <p className="muted-copy mt-1">Pick a past run to filter the People directory to just its results.</p>
          </div>
          <select className="field" name="artifactRunId" defaultValue={artifactRuns[0]?.id || ""} required>
            {artifactRuns.length === 0 ? <option value="">No runs found</option> : null}
            {artifactRuns.map((run) => (
              <option key={run.id} value={run.id}>
                {run.label}
              </option>
            ))}
          </select>
          <select className="field" name="campaignId" defaultValue={campaigns[0]?.id || ""} required>
            {campaigns.length === 0 ? <option value="">No campaigns found</option> : null}
            {campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name}
              </option>
            ))}
          </select>
          <button className="button-secondary" type="submit" disabled={artifactRuns.length === 0 || campaigns.length === 0}>
            <Filter size={16} />
            Filter by Run
          </button>
        </form>
      </div>
    </AppShell>
  );
}
