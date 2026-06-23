import { Megaphone } from "lucide-react";
import { createCampaign } from "@/app/actions";
import { AppShell } from "@/components/AppShell";
import { ExportCampaignForm } from "@/components/ExportCampaignForm";
import { getCampaigns, getPersons } from "@/lib/data/store";

export default async function CampaignsPage() {
  const campaigns = await getCampaigns();
  const people = await getPersons();

  const countByCampaign = new Map<string, number>();
  for (const person of people) {
    countByCampaign.set(person.campaignId, (countByCampaign.get(person.campaignId) || 0) + 1);
  }

  return (
    <AppShell badge="CAMPAIGNS">
      <section className="surface mb-6 overflow-hidden bg-gradient-to-br from-brand-50 via-white to-white p-7">
        <p className="page-kicker">Operations / Campaigns</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">Campaign management</h1>
        <p className="muted-copy mt-2 max-w-2xl">
          Create campaigns, review counts, and export grouped lists from a clean coordination page.
        </p>
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="grid gap-4 content-start">
          <form action={createCampaign} className="surface grid gap-3 p-6">
            <div>
              <h2 className="section-title">Create Campaign</h2>
              <p className="muted-copy mt-1">Add a new campaign to assign people to.</p>
            </div>
            <input className="field" name="name" placeholder="Campaign name" required />
            <button className="button-primary" type="submit">
              <Megaphone size={16} />
              Create Campaign
            </button>
          </form>

          <ExportCampaignForm campaigns={campaigns} />
        </div>

        <div className="surface p-6">
          <h2 className="section-title">Campaigns</h2>
          <p className="muted-copy mt-1">Named groups and how many people are assigned to each.</p>
          <div className="mt-4 divide-y divide-slate-100">
            {campaigns.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">No campaigns yet. Create one to get started.</p>
            ) : (
              campaigns.map((campaign) => (
                <div key={campaign.id} className="flex items-center justify-between py-3">
                  <span className="text-sm font-medium text-ink">{campaign.name}</span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                    {countByCampaign.get(campaign.id) || 0} people
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
