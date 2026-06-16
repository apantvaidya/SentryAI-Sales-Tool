import Link from "next/link";
import type { Person } from "@/lib/data/types";

export function LeadGenProvenance({ person }: { person: Person }) {
  if (!person.leadGenRunId) return null;
  const queries = person.sourceQueryNames?.length ? person.sourceQueryNames : person.sourceQueryIds || [];

  return (
    <section className="surface p-5">
      <h2 className="text-lg font-bold text-ink">Lead Generation</h2>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-slate-500">Overlap</dt>
          <dd className="text-xl font-bold text-ink">{person.overlapCount ?? 0}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Source queries</dt>
          <dd className="text-xl font-bold text-ink">{queries.length}</dd>
        </div>
      </dl>
      {queries.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1">
          {queries.map((name) => (
            <span key={name} className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700">
              {name}
            </span>
          ))}
        </div>
      ) : null}
      <Link href={`/people/${person.id}/lead-graph`} className="button-secondary mt-4 w-full">
        View Lead Graph
      </Link>
    </section>
  );
}
