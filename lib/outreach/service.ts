import { execFile } from "child_process";
import path from "path";
import { promisify } from "util";
import type { Contact, LeadCandidate, ProspectWorkspace } from "@/lib/data/types";

const execFileAsync = promisify(execFile);
const warmOutreachRoot = path.join(process.cwd(), "warm_outreach");

export type WarmOutreachPipelineOutput = {
  lead: {
    name: string;
    email?: string | null;
    company: string;
    location?: string | null;
    linkedin?: string | null;
    role: string;
    years_at_role?: string | null;
  };
  persona: {
    persona_type?: string;
    role_relevance?: string;
  };
  queries: unknown;
  search_results: Array<{ url?: string; title?: string; snippet?: string | null }>;
  evidence_summary: {
    safe_claims?: string[];
    unsafe_claims_to_avoid?: string[];
    best_email_angle?: string;
    source_urls?: string[];
    confidence?: string;
  };
  email: {
    subject: string;
    body: string;
  };
  validation: {
    recommendation?: "approve" | "human_review" | "reject";
    notes?: string[];
    forbidden_phrases_found?: string[];
  };
};

export type WarmOutreachExecution = {
  command: string;
  exitCode: number;
  stdoutSnippet?: string;
  stderrSnippet?: string;
  output?: WarmOutreachPipelineOutput;
  errorMessage?: string;
};

function snippet(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 2000 ? `${trimmed.slice(0, 2000)}...` : trimmed || undefined;
}

function parseLocation(notes?: string) {
  const match = notes?.match(/Location:\s*([^|]+)/i);
  return match?.[1]?.trim();
}

function yearsAtRole(candidate?: LeadCandidate) {
  return typeof candidate?.yearsAtCurrentRole === "number" ? `${candidate.yearsAtCurrentRole} years` : undefined;
}

export function contactToWarmOutreachLead(workspace: ProspectWorkspace, contact: Contact, candidate?: LeadCandidate) {
  return {
    name: contact.name || "Unknown contact",
    email: contact.email || null,
    company: candidate?.currentCompany || workspace.prospect.companyName,
    location: candidate?.resolvedLocation || parseLocation(contact.notes) || workspace.prospect.segment || null,
    linkedin: contact.linkedinUrl || candidate?.linkedinUrl || null,
    role: contact.title || candidate?.currentTitle || "Unknown role",
    years_at_role: yearsAtRole(candidate) || null
  };
}

export async function runWarmOutreachForContact(
  workspace: ProspectWorkspace,
  contact: Contact,
  candidate?: LeadCandidate,
  options: { maxResults?: number; includeRawContent?: boolean } = {}
): Promise<WarmOutreachExecution> {
  const lead = contactToWarmOutreachLead(workspace, contact, candidate);
  const args = [
    "-m",
    "warm_outreach.cli",
    "run-one",
    "--lead-json",
    JSON.stringify(lead),
    "--max-results",
    String(options.maxResults || 5)
  ];
  if (options.includeRawContent) args.push("--include-raw-content");

  const command = `python3 ${args.map((arg) => (arg.includes(" ") ? JSON.stringify(arg) : arg)).join(" ")}`;
  try {
    const { stdout, stderr } = await execFileAsync("python3", args, {
      cwd: warmOutreachRoot,
      env: {
        ...process.env,
        PYTHONPATH: path.join(warmOutreachRoot, "src")
      },
      maxBuffer: 1024 * 1024 * 8
    });
    return {
      command,
      exitCode: 0,
      stdoutSnippet: snippet(stdout),
      stderrSnippet: snippet(stderr),
      output: JSON.parse(stdout) as WarmOutreachPipelineOutput
    };
  } catch (error) {
    const execError = error as Error & { code?: number; stdout?: string; stderr?: string };
    return {
      command,
      exitCode: typeof execError.code === "number" ? execError.code : 1,
      stdoutSnippet: snippet(execError.stdout || ""),
      stderrSnippet: snippet(execError.stderr || ""),
      errorMessage: execError.message
    };
  }
}

export function evidenceSummaryText(output: WarmOutreachPipelineOutput) {
  const claims = output.evidence_summary.safe_claims || [];
  if (claims.length > 0) return claims.join(" ");
  return output.evidence_summary.best_email_angle || "No safe evidence summary was returned.";
}

export function sourceUrls(output: WarmOutreachPipelineOutput) {
  const urls = new Set<string>();
  for (const url of output.evidence_summary.source_urls || []) {
    if (url) urls.add(url);
  }
  for (const result of output.search_results || []) {
    if (result.url) urls.add(result.url);
  }
  return Array.from(urls);
}
