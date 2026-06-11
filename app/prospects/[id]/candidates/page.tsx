import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, Download, Link2, RefreshCw, UserPlus } from "lucide-react";
import {
  createLeadGenRun,
  importLeadCandidateAsContact,
  importSelectedLeadCandidates,
  registerExistingLeadGenRun,
  runBatchCandidateOutreach,
  runCandidateOutreach
} from "@/app/actions";
import { AppShell } from "@/components/AppShell";
import { WorkspaceTabs } from "@/components/WorkspaceTabs";
import { getProspectById } from "@/lib/data/store";
import { listArtifactRunIds } from "@/lib/leadgen/import";
import type { LeadCandidate, LeadCandidateStatus, LeadGenRun } from "@/lib/data/types";

function statusClass(status: LeadCandidateStatus) {
  if (status === "accepted") return "bg-emerald-50 text-emerald-700";
  if (status === "imported") return "bg-sentry-50 text-sentry-800";
  if (status === "needs_review") return "bg-amber-50 text-amber-700";
  return "bg-slate-100 text-slate-600";
}

function runLabel(run: LeadGenRun) {
  return `${run.seedPersonName || run.seedCompanyName} · ${run.artifactRunId}`;
}

function sourceQueries(candidate: LeadCandidate) {
  return candidate.sourceQueryNames?.length ? candidate.sourceQueryNames : candidate.sourceQueryIds;
}

export default async function CandidatesPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ runId?: string }>;
}) {
  const { id } = await params;
  const query = searchParams ? await searchParams : {};
  const workspace = await getProspectById(id);
  if (!workspace) notFound();

  const artifactRunIds = await listArtifactRunIds();
  const registerRunAction = registerExistingLeadGenRun.bind(null, id);
  const createRunAction = createLeadGenRun.bind(null, id);
  const runs = workspace.leadGenRuns.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const selectedRun = runs.find((run) => run.id === query.runId) || runs[0];
  const candidates = selectedRun
    ? workspace.leadCandidates
        .filter((candidate) => candidate.leadGenRunId === selectedRun.id)
        .sort((a, b) => b.overlapCount - a.overlapCount || a.fullName.localeCompare(b.fullName))
    : [];
  const importedCount = candidates.filter((candidate) => candidate.status === "imported").length;
  const acceptedCount = candidates.filter((candidate) => candidate.status === "accepted" || candidate.status === "imported").length;
  const contactById = new Map(workspace.contacts.map((contact) => [contact.id, contact]));
  const latestResearchByContactId = new Map();
  for (const research of workspace.outreachResearch.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())) {
    if (!latestResearchByContactId.has(research.contactId)) latestResearchByContactId.set(research.contactId, research);
  }
  const importSelectedAction = importSelectedLeadCandidates.bind(null, id);
  const runBatchOutreachAction = runBatchCandidateOutreach.bind(null, id);

  return (
    <AppShell>
      <Link href={`/prospects/${id}`} className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-ink">
        <ArrowLeft size={16} />
        Back to workspace
      </Link>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="page-kicker">Lead Candidates</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink">{workspace.prospect.companyName}</h1>
          <p className="mt-2 max-w-3xl text-slate-600">
            Register a lead-generation artifact run, inspect deduped candidates, and import selected people into contacts before outreach.
          </p>
        </div>
      </div>
      <WorkspaceTabs prospectId={id} active="candidates" />

      <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
        <aside className="grid content-start gap-5">
          <form action={createRunAction} className="surface grid gap-4 p-5">
            <div>
              <h2 className="section-title">Run Lead Generation</h2>
              <p className="muted-copy mt-1">Start from a seed profile and import the resulting candidates.</p>
            </div>
            <input className="field" name="seedPersonName" placeholder="Seed person name" required />
            <input className="field" name="seedRole" placeholder="Seed role" />
            <input className="field" name="seedCompanyName" placeholder="Seed company" defaultValue={workspace.prospect.companyName} required />
            <input className="field" name="seedLinkedinUrl" placeholder="Seed LinkedIn URL" />

            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <label className="flex items-start gap-2 text-sm font-semibold text-slate-700">
                <input className="mt-0.5 h-4 w-4 rounded border-slate-300" type="checkbox" name="recursiveExpansion" />
                <span>
                  Recursive expansion
                  <span className="mt-1 block text-xs font-normal leading-5 text-slate-500">
                    Pivot from each run into a similar-company lead and repeat until the target lead count is reached.
                  </span>
                </span>
              </label>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <label className="grid gap-1 text-xs font-semibold text-slate-600">
                  Target total leads
                  <input className="field" name="targetTotal" type="number" min={1} placeholder="100" defaultValue={100} />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-600">
                  Max hops
                  <input className="field" name="maxHops" type="number" min={1} placeholder="20" defaultValue={20} />
                </label>
              </div>
            </div>

            <button className="button-primary" type="submit">
              Run Exa Lead Gen
            </button>
            <p className="text-xs leading-5 text-slate-500">
              Creates Python artifacts, then imports normalized run/candidate metadata into this workspace. Recursive expansion imports one run per hop.
            </p>
          </form>

          <form action={registerRunAction} className="surface grid gap-4 p-5">
            <div>
              <h2 className="section-title">Register Artifact Run</h2>
              <p className="muted-copy mt-1">Load existing Python output into this workspace.</p>
            </div>
            <select className="field" name="artifactRunId" defaultValue={artifactRunIds[0] || ""} required>
              {artifactRunIds.length === 0 ? <option value="">No artifact runs found</option> : null}
              {artifactRunIds.map((runId) => (
                <option key={runId} value={runId}>
                  {runId}
                </option>
              ))}
            </select>
            <button className="button-primary" type="submit" disabled={artifactRunIds.length === 0}>
              <Download size={16} />
              Import Run Metadata
            </button>
            <p className="text-xs leading-5 text-slate-500">
              Imports only app-owned metadata for inspection. It does not automatically create contacts or run outreach.
            </p>
          </form>

          <section className="surface p-5">
            <h2 className="section-title">Runs</h2>
            {runs.length === 0 ? (
              <p className="mt-3 text-sm leading-6 text-slate-500">No lead-generation runs have been registered for this prospect yet.</p>
            ) : (
              <div className="mt-4 grid gap-2">
                {runs.map((run) => (
                  <Link
                    key={run.id}
                    href={`/prospects/${id}/candidates?runId=${run.id}`}
                    className={`rounded-md border px-3 py-2 text-sm transition ${
                      selectedRun?.id === run.id ? "border-sentry-500 bg-sentry-50 text-sentry-900" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <span className="block font-semibold">{run.seedPersonName || run.seedCompanyName}</span>
                    <span className="mt-1 block truncate text-xs">{run.artifactRunId}</span>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {selectedRun ? (
            <section className="surface p-5">
              <h2 className="section-title">Run Summary</h2>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-slate-500">Candidates</dt>
                  <dd className="text-xl font-bold text-ink">{candidates.length}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Accepted</dt>
                  <dd className="text-xl font-bold text-ink">{acceptedCount}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Imported</dt>
                  <dd className="text-xl font-bold text-ink">{importedCount}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Queries</dt>
                  <dd className="text-xl font-bold text-ink">{selectedRun.queryStats?.length || 0}</dd>
                </div>
              </dl>
            </section>
          ) : null}
        </aside>

        <section className="surface overflow-hidden">
          <div className="border-b border-slate-200 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="section-title">{selectedRun ? runLabel(selectedRun) : "No run selected"}</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {selectedRun ? "Read-only lead-gen evidence with explicit contact import actions." : "Register an artifact run to populate candidates."}
                </p>
              </div>
              {selectedRun ? (
                <span className="inline-flex items-center gap-2 rounded-md bg-slate-100 px-3 py-2 text-sm font-semibold capitalize text-slate-700">
                  <RefreshCw size={15} />
                  {selectedRun.status}
                </span>
              ) : null}
            </div>
          </div>

          {candidates.length === 0 ? (
            <div className="p-10 text-center text-slate-500">No candidates available for this run.</div>
          ) : (
            <form className="grid" action={importSelectedAction}>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-sm text-slate-600">Select up to 10 candidates for batch outreach. Outreach will import missing contacts first.</p>
                <div className="flex flex-wrap gap-2">
                  <button className="button-secondary" type="submit">
                    <UserPlus size={15} />
                    Import Selected
                  </button>
                  <button className="button-primary" formAction={runBatchOutreachAction} type="submit">
                    Run Outreach Selected
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Select</th>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Role</th>
                    <th className="px-4 py-3">Company</th>
                    <th className="px-4 py-3">Location</th>
                    <th className="px-4 py-3">Overlap</th>
                    <th className="px-4 py-3">Source Queries</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Contact</th>
                    <th className="px-4 py-3">Outreach</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {candidates.map((candidate) => {
                    const contact = candidate.importedContactId ? contactById.get(candidate.importedContactId) : undefined;
                    const latestResearch = contact ? latestResearchByContactId.get(contact.id) : undefined;
                    const importAction = importLeadCandidateAsContact.bind(null, id, candidate.id);
                    const outreachAction = runCandidateOutreach.bind(null, id, candidate.id);
                    return (
                      <tr key={candidate.id} className="align-top">
                        <td className="px-4 py-4">
                          <input className="h-4 w-4 rounded border-slate-300" type="checkbox" name="candidateIds" value={candidate.id} />
                        </td>
                        <td className="px-4 py-4">
                          <div className="font-semibold text-ink">{candidate.fullName}</div>
                          {candidate.linkedinUrl ? (
                            <a href={candidate.linkedinUrl} target="_blank" className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-sentry-700">
                              <Link2 size={13} />
                              LinkedIn
                            </a>
                          ) : (
                            <div className="mt-1 text-xs text-amber-700">Fallback identity</div>
                          )}
                        </td>
                        <td className="px-4 py-4 text-slate-700">{candidate.currentTitle || "Unknown role"}</td>
                        <td className="px-4 py-4 text-slate-700">{candidate.currentCompany || "Unknown company"}</td>
                        <td className="px-4 py-4 text-slate-700">{candidate.resolvedLocation || "Unknown"}</td>
                        <td className="px-4 py-4">
                          <span className="rounded-md bg-slate-100 px-2 py-1 font-bold text-slate-700">{candidate.overlapCount}</span>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex max-w-72 flex-wrap gap-1">
                            {sourceQueries(candidate).slice(0, 4).map((queryName) => (
                              <span key={queryName} className="rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-600">
                                {queryName}
                              </span>
                            ))}
                            {sourceQueries(candidate).length > 4 ? (
                              <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
                                +{sourceQueries(candidate).length - 4}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <span className={`rounded-md px-2 py-1 text-xs font-bold capitalize ${statusClass(candidate.status)}`}>
                            {candidate.status.replace("_", " ")}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          {contact ? (
                            <div className="grid gap-1">
                              <Link href={`/prospects/${id}/contacts`} className="inline-flex items-center gap-2 text-sm font-semibold text-sentry-700">
                                <CheckCircle2 size={16} />
                                {contact.name}
                              </Link>
                              {latestResearch ? (
                                <Link href={`/prospects/${id}/crime-research`} className="text-xs font-semibold text-slate-600">
                                  Research: {latestResearch.validationRecommendation.replace("_", " ")}
                                </Link>
                              ) : (
                                <span className="text-xs text-slate-500">No research yet</span>
                              )}
                            </div>
                          ) : (
                            <button className="button-secondary px-3 py-1.5" formAction={importAction} type="submit">
                              <UserPlus size={15} />
                              Import
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-4">
                          <button className="button-secondary px-3 py-1.5" formAction={outreachAction} type="submit">
                            Run Outreach
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </form>
          )}
        </section>
      </div>
    </AppShell>
  );
}
