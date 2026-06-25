import { getQueryTargeting } from "./queryTargeting";

type WorkHistoryJob = {
  title?: string;
  location?: string;
  description?: string;
  company?: { name?: string };
  dates?: { from?: string; to?: string };
};

type ExaEntity = {
  properties?: {
    name?: string;
    location?: string;
    workHistory?: WorkHistoryJob[];
  };
};

type ExaSearchResponse = {
  results?: Array<{
    url?: string;
    entities?: ExaEntity[];
  }>;
};

function selectCurrentJob(workHistory: WorkHistoryJob[]): WorkHistoryJob | null {
  const open = workHistory.filter((j) => !j.dates?.to);
  if (open.length > 0) return open[0];
  return (
    workHistory
      .filter((j) => j.dates?.from)
      .sort((a, b) => (b.dates!.from! > a.dates!.from! ? 1 : -1))[0] ?? null
  );
}

export async function enrichPersonFromLinkedIn(person: {
  name: string;
  companyName: string;
  linkedinUrl?: string;
}): Promise<{ location?: string; title?: string; currentRoleDescription?: string } | null> {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) return null;

  const targeting = await getQueryTargeting();
  const query = `"${person.name}" ${person.companyName} ${targeting.querySuffix}`.trim();
  const payload: Record<string, unknown> = {
    query,
    category: "people",
    type: "auto",
    numResults: 3,
    includeDomains: ["linkedin.com"],
    userLocation: targeting.userLocation,
  };

  try {
    const response = await fetch(
      process.env.EXA_API_URL || "https://api.exa.ai/search",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      }
    );

    if (!response.ok) return null;
    const data: ExaSearchResponse = await response.json();
    const results = data.results ?? [];

    // Prefer the result whose URL matches the stored LinkedIn URL
    const normalise = (u?: string) =>
      (u ?? "").toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

    const storedNorm = normalise(person.linkedinUrl);
    const match =
      (storedNorm
        ? results.find((r) => {
            const rn = normalise(r.url);
            return rn === storedNorm || rn.includes(storedNorm) || storedNorm.includes(rn);
          })
        : undefined) ?? results[0];

    if (!match) return null;

    const props = match.entities?.[0]?.properties;
    if (!props) return null;

    const workHistory: WorkHistoryJob[] = props.workHistory ?? [];
    const currentJob = selectCurrentJob(workHistory);

    // Location: top-level profile location first, then current job's location
    const location = props.location || currentJob?.location || undefined;

    // Title: current/most-recent job title
    const title = currentJob?.title || undefined;

    const currentRoleDescription = currentJob?.description || undefined;

    if (!location && !title && !currentRoleDescription) return null;
    return { location, title, currentRoleDescription };
  } catch {
    return null;
  }
}
