import { execFile } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const leadGenRoot = path.join(process.cwd(), "lead_generation_mod");

export type LeadGenSeedPayload = {
  person_name: string;
  role?: string;
  company_name: string;
  linkedin_url?: string;
};

export type LeadGenExecution = {
  command: string;
  exitCode: number;
  runId?: string;
  stdoutSnippet?: string;
  stderrSnippet?: string;
  errorMessage?: string;
};

function snippet(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 2000 ? `${trimmed.slice(0, 2000)}...` : trimmed || undefined;
}

export async function runLeadGeneration(seed: LeadGenSeedPayload, options: { numResults?: number } = {}): Promise<LeadGenExecution> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "smart-sentry-leadgen-"));
  const seedPath = path.join(tempDir, "seed.json");
  await fs.writeFile(seedPath, JSON.stringify(seed, null, 2));

  const args = ["-m", "exa_searching.cli", "run-seed", "--input", seedPath];
  if (options.numResults) args.push("--num-results", String(options.numResults));
  const command = `python3 ${args.map((arg) => (arg.includes(" ") ? JSON.stringify(arg) : arg)).join(" ")}`;

  try {
    const { stdout, stderr } = await execFileAsync("python3", args, {
      cwd: leadGenRoot,
      env: {
        ...process.env,
        PYTHONPATH: leadGenRoot
      },
      maxBuffer: 1024 * 1024 * 8
    });
    const parsed = JSON.parse(stdout) as { run_id?: string };
    return {
      command,
      exitCode: 0,
      runId: parsed.run_id,
      stdoutSnippet: snippet(stdout),
      stderrSnippet: snippet(stderr)
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
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
