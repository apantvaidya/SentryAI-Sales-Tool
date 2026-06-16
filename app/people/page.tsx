import Link from "next/link";
import { Download, UserPlus } from "lucide-react";
import { createLeadGenRun, createPerson, registerExistingLeadGenRun } from "@/app/actions";
import { AppShell } from "@/components/AppShell";
import { BatchJobStatus } from "@/components/BatchJobStatus";
import { PeopleTable } from "@/components/PeopleTable";
import { getPeopleForLeadGenRun, getPersons } from "@/lib/data/store";
import { listArtifactRunIds } from "@/lib/leadgen/import";

export default async function PeoplePage({ searchParams }: { searchParams?: Promise<{ runId?: string; jobId?: string }> }) {
  const query = searchParams ? await searchParams : {};
  const allPeople = await getPersons();
  const people = query.runId ? await getPeopleForLeadGenRun(query.runId) : allPeople;
  const artifactRunIds = await listArtifactRunIds();

  return (
    <AppShell>
      <div className="mb-6">
        <p className="text-sm font-bold uppercase tracking-wide text-sentry-700">CRM</p>
        <h1 className="mt-2 text-3xl font-bold text-ink">People</h1>
        <p className="mt-2 max-w-3xl text-slate-600">
          Everyone discovered through lead generation or added manually. Click a person to see their details, drafts, and status.
        </p>
      </div>

      {query.jobId ? <BatchJobStatus jobId={query.jobId} /> : null}

      {query.runId ? (
        <p className="mb-4 text-sm text-slate-600">
          Showing {people.length} people from the most recent run. <Link href="/people" className="font-semibold text-sentry-700">Clear filter</Link>
        </p>
      ) : null}

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <form action={createLeadGenRun} className="surface grid gap-3 p-5">
          <div>
            <h2 className="section-title">Find People</h2>
            <p className="muted-copy mt-1">Start from a seed profile and import the resulting candidates.</p>
          </div>
          <input className="field" name="seedPersonName" placeholder="Seed person name" required />
          <input className="field" name="seedRole" placeholder="Seed role" />
          <input className="field" name="seedCompanyName" placeholder="Seed company" required />
          <input className="field" name="seedLinkedinUrl" placeholder="Seed LinkedIn URL" />
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
          <button className="button-primary" type="submit">
            Run Exa Lead Gen
          </button>

          <div className="mt-2 border-t border-slate-200 pt-3">
            <p className="text-xs font-semibold text-slate-600">Or import an existing artifact run:</p>
          </div>
        </form>

        <div className="grid gap-4">
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
            <button className="button-primary" type="submit">
              <UserPlus size={16} />
              Add Person
            </button>
          </form>

          <form action={registerExistingLeadGenRun} className="surface grid gap-3 p-5">
            <select className="field" name="artifactRunId" defaultValue={artifactRunIds[0] || ""} required>
              {artifactRunIds.length === 0 ? <option value="">No artifact runs found</option> : null}
              {artifactRunIds.map((runId) => (
                <option key={runId} value={runId}>
                  {runId}
                </option>
              ))}
            </select>
            <button className="button-secondary" type="submit" disabled={artifactRunIds.length === 0}>
              <Download size={16} />
              Import Run Metadata
            </button>
          </form>
        </div>
      </div>

      <PeopleTable people={people} />
    </AppShell>
  );
}
