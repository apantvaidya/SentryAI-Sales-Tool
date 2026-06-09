import { CheckSquare } from "lucide-react";

export function ResearchChecklist() {
  const items = [
    "Contact title verified?",
    "Company relevance verified?",
    "Email verified?",
    "Personalization reviewed?",
    "Claims accurate?"
  ];
  return (
    <div className="surface p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-slate-100 text-slate-800">
          <CheckSquare size={17} />
        </span>
        <h3 className="font-bold text-ink">Review Checklist</h3>
      </div>
      <div className="mt-3 grid gap-2">
        {items.map((item) => (
          <label key={item} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
            <input type="checkbox" className="h-4 w-4 rounded border-slate-300 accent-sentry-700" />
            {item}
          </label>
        ))}
      </div>
    </div>
  );
}
