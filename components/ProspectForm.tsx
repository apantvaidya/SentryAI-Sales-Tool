import { createProspect } from "@/app/actions";

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
          <label className="label" htmlFor="firstName">
            First name
          </label>
          <input className="field" id="firstName" name="firstName" required placeholder="Jane" />
        </div>
        <div className="grid gap-2">
          <label className="label" htmlFor="lastName">
            Last name
          </label>
          <input className="field" id="lastName" name="lastName" required placeholder="Doe" />
        </div>
      </div>
      <div className="grid gap-2">
        <label className="label" htmlFor="role">
          Role
        </label>
        <input className="field" id="role" name="role" required placeholder="Director of Security" />
      </div>
      <div className="grid gap-2">
        <label className="label" htmlFor="linkedinUrl">
          LinkedIn URL <span className="text-slate-400 font-normal">(optional)</span>
        </label>
        <input
          className="field"
          id="linkedinUrl"
          name="linkedinUrl"
          type="url"
          placeholder="https://www.linkedin.com/in/janedoe"
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
