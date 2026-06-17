import Link from "next/link";
import { Filter, Megaphone, Upload, UserPlus, X } from "lucide-react";
import { createCampaign, createLeadGenRun, createPerson, importPeopleCsv, registerExistingLeadGenRun } from "@/app/actions";
import { AppShell } from "@/components/AppShell";
import { BatchJobStatus } from "@/components/BatchJobStatus";
import { PendingButton } from "@/components/PendingButton";
import { PersistentJobBanner } from "@/components/PersistentJobBanner";
import { ExportCampaignForm } from "@/components/ExportCampaignForm";
import { PeopleTable } from "@/components/PeopleTable";
import { getCampaigns, getLeadGenRun, getPeopleForLeadGenRun, getPersons } from "@/lib/data/store";
import { listArtifactRuns } from "@/lib/leadgen/import";

export default async function PeoplePage({ searchParams }: { searchParams?: Promise<{ runId?: string; jobId?: string }> }) {
  const query = searchParams ? await searchParams : {};
  const allPeople = await getPersons();
  const activeRun = query.runId ? await getLeadGenRun(query.runId) : null;
  const people = query.runId ? await getPeopleForLeadGenRun(query.runId) : allPeople;
  const artifactRuns = await listArtifactRuns();
  const campaigns = await getCampaigns();

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="mt-2 text-3xl font-bold text-ink">People</h1>

      </div>

      {query.jobId ? <BatchJobStatus jobId={query.jobId} /> : null}
      <PersistentJobBanner />

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

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        {/* Left column: lead-gen actions */}
        <div className="grid gap-4 content-start">
          <form action={createLeadGenRun} className="surface grid gap-3 p-5">
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
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
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

          <form action={importPeopleCsv} className="surface grid gap-3 p-5">
            <div>
              <h2 className="section-title">Import from CSV</h2>
              <p className="muted-copy mt-1">
                Upload a CSV with <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">name</code> and{" "}
                <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">company</code> columns. Optional:{" "}
                <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">title</code>,{" "}
                <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">email</code>,{" "}
                <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">linkedin_url</code>,{" "}
                <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">location</code>,{" "}
                <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">notes</code>.
              </p>
            </div>
            <select className="field" name="campaignId" defaultValue={campaigns[0]?.id || ""} required>
              {campaigns.length === 0 ? <option value="">No campaigns found</option> : null}
              {campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </option>
              ))}
            </select>
            <input className="field" name="defaultCompany" placeholder="Default company (if CSV has no company column)" />
            <input className="field" type="file" name="csvFile" accept=".csv,text/csv" required />
            <PendingButton className="button-secondary" disabled={campaigns.length === 0} pendingText="Importing…">
              <Upload size={16} />
              Import CSV
            </PendingButton>
          </form>
        </div>

        {/* Right column: management actions */}
        <div className="grid gap-4 content-start">
          <form action={createPerson} className="surface grid gap-3 p-5">
            <div>
              <h2 className="section-title">Add Person</h2>
              <p className="muted-copy mt-1">Manually add a person and generate company intelligence for them.</p>
            </div>
            <input className="field" name="companyName" placeholder="Company name" required />
            <div className="grid grid-cols-2 gap-2">
              <input className="field" name="firstName" placeholder="First name" required />
              <input className="field" name="lastName" placeholder="Last name" required />
            </div>
            <input className="field" name="role" placeholder="Role" required />
            <input className="field" name="linkedinUrl" placeholder="LinkedIn URL" />
            <select className="field" name="campaignId" defaultValue={campaigns[0]?.id || ""} required>
              {campaigns.length === 0 ? <option value="">No campaigns found</option> : null}
              {campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </option>
              ))}
            </select>
            <button className="button-primary" type="submit" disabled={campaigns.length === 0}>
              <UserPlus size={16} />
              Add Person
            </button>
          </form>

          <form action={registerExistingLeadGenRun} className="surface grid gap-3 p-5">
            <div>
              <h2 className="section-title">Filter by Run</h2>
              <p className="muted-copy mt-1">Pick a past run to filter the People list below to just its results.</p>
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

          <form action={createCampaign} className="surface grid gap-3 p-5">
            <div>
              <h2 className="section-title">Create Campaign</h2>
              <p className="muted-copy mt-1">Add a new campaign to assign people to.</p>
            </div>
            <input className="field" name="name" placeholder="Campaign name" required />
            <button className="button-secondary" type="submit">
              <Megaphone size={16} />
              Create Campaign
            </button>
          </form>

          <ExportCampaignForm campaigns={campaigns} />
        </div>
      </div>

      <PeopleTable people={people} campaigns={campaigns} />
    </AppShell>
  );
}
