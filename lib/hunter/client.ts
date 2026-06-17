type HunterEmailFinderResponse = {
  data?: {
    email?: string;
    score?: number;
  };
  errors?: Array<{ id: string; code: number; details: string }>;
};

export type HunterResult = {
  email: string;
  score: number;
};

export function parseName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  return { firstName: parts[0] || "", lastName: parts.slice(1).join(" ") };
}

export function extractDomain(website: string): string | null {
  try {
    const url = website.startsWith("http") ? website : `https://${website}`;
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

type ClearbitSuggestion = { name: string; domain: string };

const LEGAL_SUFFIXES =
  /,?\s*(Inc\.?|LLC\.?|L\.L\.C\.?|Corp\.?|Corporation|Ltd\.?|Limited|Co\.?|Companies|Company|Group|Holdings|International|PLC|PLC\.?|S\.A\.?)\b\.?/gi;

function companyNameCandidates(companyName: string): string[] {
  const seen = new Set<string>();
  const candidates: string[] = [];

  const add = (s: string) => {
    const t = s.trim().replace(/\s+/g, " ").replace(/,\s*$/, "").trim();
    if (t && !seen.has(t)) { seen.add(t); candidates.push(t); }
  };

  // 1. Strip parentheticals and legal suffixes
  const stripped = companyName
    .replace(/\(.*?\)/g, "")
    .replace(LEGAL_SUFFIXES, "")
    .replace(/^the\s+/i, "");
  add(stripped);

  // 2. If " and " or "/" separates brands, try just the first part
  const firstPart = stripped.split(/\s+and\s+|\s*[\/|]\s*/i)[0];
  add(firstPart);

  // 3. First two words of the cleaned name (handles "Save Mart Companies" → "Save Mart")
  const words = stripped.split(" ").filter(Boolean);
  if (words.length > 2) add(words.slice(0, 2).join(" "));

  // 4. Always try the raw original last
  add(companyName);

  return candidates;
}

export async function findCompanyDomain(companyName: string): Promise<string | null> {
  for (const candidate of companyNameCandidates(companyName)) {
    try {
      const url = `https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(candidate)}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
      if (!response.ok) continue;
      const results: ClearbitSuggestion[] = await response.json();
      if (results[0]?.domain) return results[0].domain;
    } catch {
      // try next candidate
    }
  }
  return null;
}

export async function findEmailWithHunter(params: {
  firstName: string;
  lastName: string;
  domain: string;
}): Promise<HunterResult | null> {
  const apiKey = process.env.HUNTER_API_KEY;
  if (!apiKey) return null;

  const url = new URL("https://api.hunter.io/v2/email-finder");
  url.searchParams.set("domain", params.domain);
  url.searchParams.set("first_name", params.firstName);
  url.searchParams.set("last_name", params.lastName);
  url.searchParams.set("api_key", apiKey);

  const response = await fetch(url.toString(), {
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) return null;

  const data: HunterEmailFinderResponse = await response.json();
  if (!data.data?.email) return null;

  return { email: data.data.email, score: data.data.score ?? 0 };
}
