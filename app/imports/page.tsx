import { Upload, UserPlus } from "lucide-react";
import { createPerson, importPeopleCsv } from "@/app/actions";
import { AppShell } from "@/components/AppShell";
import { PendingButton } from "@/components/PendingButton";
import { getCampaigns } from "@/lib/data/store";

export default async function ImportsPage() {
  const campaigns = await getCampaigns();

  return (
    <AppShell badge="IMPORT">
      <section className="surface mb-6 overflow-hidden bg-gradient-to-br from-brand-50 via-white to-white p-7">
        <p className="page-kicker">Operations / Import</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">Imports and manual entry</h1>
        <p className="muted-copy mt-2 max-w-2xl">
          Bring in CSVs or add a single person without mixing those tasks into the directory view.
        </p>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <form action={importPeopleCsv} className="surface grid gap-3 p-6 content-start">
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

        <form action={createPerson} className="surface grid gap-3 p-6 content-start">
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
      </div>
    </AppShell>
  );
}
