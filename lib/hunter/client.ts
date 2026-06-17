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
