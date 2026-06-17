type VerifyStatus = "deliverable" | "accept_all" | "risky" | "undeliverable" | "unknown";

type HunterDomainSearchResponse = {
  data?: { pattern?: string };
};

type HunterVerifyResponse = {
  data?: { result?: string };
};

export type PermutationResult = {
  email: string;
  source: "pattern" | "permutation";
  pattern?: string;
  verified: boolean;
};

// Strip accents (e.g. García → garcia), lowercase, keep only a-z
function normalize(str: string): string {
  return str
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

function applyHunterPattern(
  pattern: string,
  firstName: string,
  lastName: string,
  domain: string
): string | null {
  const f = normalize(firstName);
  const l = normalize(lastName);
  if (!f || !l) return null;

  const local = pattern
    .replace(/\{first\}/g, f)
    .replace(/\{last\}/g, l)
    .replace(/\{f\}/g, f[0])
    .replace(/\{l\}/g, l[0]);

  if (!local.trim()) return null;
  return `${local}@${domain}`;
}

function generatePermutations(firstName: string, lastName: string, domain: string): string[] {
  const f = normalize(firstName);
  const l = normalize(lastName);
  if (!f || !l) return [];

  return [
    `${f}.${l}@${domain}`,
    `${f[0]}${l}@${domain}`,
    `${f}${l}@${domain}`,
    `${f}@${domain}`,
    `${f}${l[0]}@${domain}`,
    `${f}_${l}@${domain}`,
    `${l}.${f}@${domain}`,
    `${l}@${domain}`,
  ];
}

async function getCompanyEmailPattern(domain: string): Promise<string | null> {
  const apiKey = process.env.HUNTER_API_KEY;
  if (!apiKey) return null;

  try {
    const url = new URL("https://api.hunter.io/v2/domain-search");
    url.searchParams.set("domain", domain);
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("limit", "5");

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;

    const data: HunterDomainSearchResponse = await res.json();
    return data.data?.pattern ?? null;
  } catch {
    return null;
  }
}

async function verifyEmail(email: string): Promise<VerifyStatus> {
  const apiKey = process.env.HUNTER_API_KEY;
  if (!apiKey) return "unknown";

  try {
    const url = new URL("https://api.hunter.io/v2/email-verifier");
    url.searchParams.set("email", email);
    url.searchParams.set("api_key", apiKey);

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return "unknown";

    const data: HunterVerifyResponse = await res.json();
    return (data.data?.result ?? "unknown") as VerifyStatus;
  } catch {
    return "unknown";
  }
}

export async function findEmailByPermutation(params: {
  firstName: string;
  lastName: string;
  domain: string;
}): Promise<PermutationResult | null> {
  const { firstName, lastName, domain } = params;

  const candidates: Array<{ email: string; source: "pattern" | "permutation"; pattern?: string }> = [];

  // 1. Pattern from Hunter domain search (highest priority — company-specific)
  const pattern = await getCompanyEmailPattern(domain);
  if (pattern) {
    const email = applyHunterPattern(pattern, firstName, lastName, domain);
    if (email) candidates.push({ email, source: "pattern", pattern });
  }

  // 2. Common permutations (fallback)
  for (const email of generatePermutations(firstName, lastName, domain)) {
    if (!candidates.some((c) => c.email === email)) {
      candidates.push({ email, source: "permutation" });
    }
  }

  // Verify in order — prefer "deliverable", accept "accept_all"/"risky" as best-effort
  let bestFallback: (typeof candidates)[0] | null = null;

  for (const candidate of candidates) {
    const status = await verifyEmail(candidate.email);
    if (status === "deliverable") {
      return { ...candidate, verified: true };
    }
    if (!bestFallback && (status === "accept_all" || status === "risky")) {
      bestFallback = candidate;
    }
  }

  if (bestFallback) {
    return { ...bestFallback, verified: false };
  }

  return null;
}
