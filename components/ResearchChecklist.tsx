export function ResearchChecklist() {
  const items = [
    "Contact title verified?",
    "Company relevance verified?",
    "Email verified?",
    "Personalization reviewed?",
    "Claims accurate?"
  ];
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <h3 className="font-bold text-amber-950">Research quality checklist</h3>
      <div className="mt-3 grid gap-2">
        {items.map((item) => (
          <label key={item} className="flex items-center gap-2 text-sm text-amber-950">
            <input type="checkbox" className="h-4 w-4 rounded border-amber-300" />
            {item}
          </label>
        ))}
      </div>
    </div>
  );
}
