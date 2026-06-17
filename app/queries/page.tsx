import { AppShell } from "@/components/AppShell";
import { QueryTemplateManager } from "@/components/QueryTemplateManager";
import { listQueryTemplates } from "@/lib/leadgen/queryTemplates";
import { getQueryTargeting } from "@/lib/leadgen/queryTargeting";

export default async function QueriesPage() {
  const [queries, targeting] = await Promise.all([listQueryTemplates(), getQueryTargeting()]);

  return (
    <AppShell>
      <div className="mb-6">
        <p className="page-kicker">Exa Lead Gen</p>
        <h1 className="mt-2 text-3xl font-bold text-ink">Queries</h1>
        <p className="muted-copy mt-2 max-w-3xl">
          Edit the query templates used by future Exa lead generation runs. File names control the query id and bucket:
          names starting with <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">same_company</code> stay in the
          same-company bucket; everything else runs as similar-company search.
        </p>
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">Location targeting is query-based and editable below.</p>
          <p className="mt-1 leading-6">
            Every Exa query is automatically appended with{" "}
            <code className="rounded bg-white/70 px-1 py-0.5 text-xs">{targeting.querySuffix}</code> before it runs.
            Exa also receives{" "}
            <code className="rounded bg-white/70 px-1 py-0.5 text-xs">userLocation: {targeting.userLocation}</code> as
            a country-level hint, because Exa only accepts country codes for that API field.
          </p>
        </div>
      </div>
      <QueryTemplateManager queries={queries} targeting={targeting} />
    </AppShell>
  );
}
