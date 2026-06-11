import { AppShell } from "@/components/AppShell";
import { PeopleTable } from "@/components/PeopleTable";
import { getAllCandidates } from "@/lib/data/store";

export default async function PeoplePage() {
  const candidates = await getAllCandidates();

  return (
    <AppShell>
      <div className="mb-6">
        <p className="text-sm font-bold uppercase tracking-wide text-sentry-700">CRM</p>
        <h1 className="mt-2 text-3xl font-bold text-ink">People</h1>
        <p className="mt-2 max-w-3xl text-slate-600">
          All lead candidates discovered across every prospect workspace.
        </p>
      </div>

      <PeopleTable candidates={candidates} />
    </AppShell>
  );
}
