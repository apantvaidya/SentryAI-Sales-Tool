import { existsSync } from "fs";
import { execFile } from "child_process";
import path from "path";
import { promisify } from "util";
import type { Person } from "@/lib/data/types";

const execFileAsync = promisify(execFile);
const warmOutreachRoot = path.join(process.cwd(), "warm_outreach");
const isWindows = process.platform === "win32";
// On Windows, venvs put executables in Scripts/python.exe, not bin/python(3).
// "python3" also isn't reliable on Windows: it often resolves to the
// Microsoft Store app-execution-alias stub instead of a real interpreter.
const systemPython = isWindows ? "python" : "python3";
const warmOutreachPythonCandidates = [
  path.join(warmOutreachRoot, ".venv", isWindows ? "Scripts" : "bin", isWindows ? "python.exe" : "python"),
  path.join(warmOutreachRoot, ".venv", isWindows ? "Scripts" : "bin", isWindows ? "python.exe" : "python3"),
  systemPython
] as const;

export type WarmOutreachPipelineOutput = {
  lead: {
    name: string;
    email?: string | null;
    company: string;
    location?: string | null;
    linkedin?: string | null;
    role: string;
    years_at_role?: string | null;
    current_role_description?: string | null;
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

function yearsAtRole(person: Person) {
  return typeof person.yearsAtCurrentRole === "number" ? `${person.yearsAtCurrentRole} years` : undefined;
}

function warmOutreachPython() {
  return warmOutreachPythonCandidates.find((candidate) => candidate === systemPython || existsSync(candidate)) || systemPython;
}

function warmOutreachSetupHint() {
  return [
    "Warm outreach Python dependencies are not installed for this app yet.",
    `From ${warmOutreachRoot}, run:`,
    `${systemPython} -m venv .venv`,
    isWindows ? ".venv\\Scripts\\pip install -e .[dev]" : "./.venv/bin/pip install -e .[dev]"
  ].join("\n");
}

function warmOutreachConfigHint(variableName: string) {
  return [
    `${variableName} is not set for the warm outreach pipeline.`,
    "Set it in the app environment or create warm_outreach/.env with the required keys."
  ].join("\n");
}

function augmentWarmOutreachError(errorMessage: string, stderr?: string) {
  const combined = `${errorMessage}\n${stderr || ""}`;
  if (/No module named '([^']+)'/.test(combined)) {
    return `${errorMessage}\n\n${warmOutreachSetupHint()}`;
  }
  if (combined.includes("TAVILY_API_KEY is not set.")) {
    return `${errorMessage}\n\n${warmOutreachConfigHint("TAVILY_API_KEY")}`;
  }
  if (combined.includes("OPENAI_API_KEY is not set.")) {
    return `${errorMessage}\n\n${warmOutreachConfigHint("OPENAI_API_KEY")}`;
  }
  return errorMessage;
}

export function personToWarmOutreachLead(person: Person) {
  return {
    name: person.name || "Unknown contact",
    email: person.email || null,
    company: person.companyName,
    location: person.location || person.companySegment || null,
    linkedin: person.linkedinUrl || null,
    role: person.title || "Unknown role",
    years_at_role: yearsAtRole(person) || null,
    current_role_description: person.currentRoleDescription || null
  };
}

export async function runWarmOutreachForPerson(
  person: Person,
  options: { maxResults?: number; includeRawContent?: boolean } = {}
): Promise<WarmOutreachExecution> {
  const lead = personToWarmOutreachLead(person);
  const pythonExecutable = warmOutreachPython();
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

  const command = `${pythonExecutable} ${args.map((arg) => (arg.includes(" ") ? JSON.stringify(arg) : arg)).join(" ")}`;
  try {
    const { stdout, stderr } = await execFileAsync(pythonExecutable, args, {
      cwd: warmOutreachRoot,
      env: {
        ...process.env,
        PYTHONPATH: path.join(warmOutreachRoot, "src"),
        // Windows defaults stdout to the system codepage (e.g. cp1252) when piped,
        // which throws on non-ASCII output (e.g. "‑" U+2011) instead of using UTF-8.
        PYTHONIOENCODING: "utf-8"
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
    const stderr = execError.stderr || "";
    return {
      command,
      exitCode: typeof execError.code === "number" ? execError.code : 1,
      stdoutSnippet: snippet(execError.stdout || ""),
      stderrSnippet: snippet(stderr),
      errorMessage: augmentWarmOutreachError(execError.message, stderr)
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
