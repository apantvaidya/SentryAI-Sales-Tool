import { createProspect } from "@/app/actions";

const segments = [
  "enterprise",
  "property management",
  "logistics",
  "campuses",
  "retail",
  "municipalities",
  "security companies"
];

export function ProspectForm() {
  return (
    <form action={createProspect} className="surface grid gap-5 p-6">
      <div className="grid gap-2">
        <label className="label" htmlFor="companyName">
          Company name
        </label>
        <input className="field" id="companyName" name="companyName" required placeholder="Acme Logistics" />
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="grid gap-2">
          <label className="label" htmlFor="website">
            Website URL
          </label>
          <input className="field" id="website" name="website" type="url" placeholder="https://example.com" />
        </div>
        <div className="grid gap-2">
          <label className="label" htmlFor="industry">
            Industry
          </label>
          <input className="field" id="industry" name="industry" placeholder="Logistics, retail, education..." />
        </div>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="grid gap-2">
          <label className="label" htmlFor="companySize">
            Company size
          </label>
          <input className="field" id="companySize" name="companySize" placeholder="500-1000 employees" />
        </div>
        <div className="grid gap-2">
          <label className="label" htmlFor="segment">
            Target segment
          </label>
          <select className="field" id="segment" name="segment" defaultValue="">
            <option value="">Select segment</option>
            {segments.map((segment) => (
              <option key={segment} value={segment}>
                {segment}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid gap-2">
        <label className="label" htmlFor="notes">
          Known pain points or notes
        </label>
        <textarea
          className="field min-h-32"
          id="notes"
          name="notes"
          placeholder="Distributed sites, guard staffing challenges, high camera count..."
        />
      </div>
      <div className="flex items-center justify-between border-t border-slate-100 pt-5">
        <p className="text-sm text-slate-500">Creates a saved workspace and generates a first research brief.</p>
        <button className="button-primary" type="submit">
          Generate Prospect Brief
        </button>
      </div>
    </form>
  );
}
