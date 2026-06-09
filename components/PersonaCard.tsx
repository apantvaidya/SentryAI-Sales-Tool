import type { BuyerPersona } from "@/lib/data/types";
import { FitScoreBadge } from "./FitScoreBadge";

export function PersonaCard({ persona }: { persona: BuyerPersona }) {
  return (
    <article className="surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-ink">{persona.personaName}</h3>
          <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{persona.roleTitles.join(" | ")}</p>
        </div>
        <FitScoreBadge score={persona.priorityScore} />
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-700">{persona.valueProposition}</p>
      <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Objection handling</p>
        <p className="mt-1 text-sm text-slate-700">{persona.objectionHandling}</p>
      </div>
    </article>
  );
}
