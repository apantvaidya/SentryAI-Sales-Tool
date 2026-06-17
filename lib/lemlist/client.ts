type LemlistStartResponse = { id: string };

type LemlistResultResponse = {
  enrichmentStatus: string;
  data?: {
    email?: {
      email?: string;
      notFound?: boolean;
    };
  };
};

function authHeader(): string {
  return "Basic " + Buffer.from(`:${process.env.LEMLIST_API_KEY ?? ""}`).toString("base64");
}

async function startEnrichment(params: {
  firstName: string;
  lastName: string;
  companyDomain: string;
  linkedinUrl?: string;
}): Promise<string | null> {
  const url = new URL("https://api.lemlist.com/api/enrich");
  url.searchParams.set("findEmail", "true");
  url.searchParams.set("firstName", params.firstName);
  url.searchParams.set("lastName", params.lastName);
  url.searchParams.set("companyDomain", params.companyDomain);
  if (params.linkedinUrl) url.searchParams.set("linkedinUrl", params.linkedinUrl);

  try {
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: { Authorization: authHeader() },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data: LemlistStartResponse = await res.json();
    return data.id ?? null;
  } catch {
    return null;
  }
}

async function pollEnrichment(enrichId: string): Promise<string | null> {
  for (let attempt = 0; attempt < 8; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2_000));

    try {
      const res = await fetch(`https://api.lemlist.com/api/enrich/${enrichId}`, {
        headers: { Authorization: authHeader() },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 202) continue;
      if (!res.ok) return null;

      const data: LemlistResultResponse = await res.json();
      if (data.enrichmentStatus !== "done") continue;

      const found = data.data?.email;
      if (found?.email && !found.notFound) return found.email;
      return null;
    } catch {
      return null;
    }
  }
  return null;
}

export async function findEmailWithLemlist(params: {
  firstName: string;
  lastName: string;
  domain: string;
  linkedinUrl?: string;
}): Promise<string | null> {
  if (!process.env.LEMLIST_API_KEY) return null;

  const enrichId = await startEnrichment({
    firstName: params.firstName,
    lastName: params.lastName,
    companyDomain: params.domain,
    linkedinUrl: params.linkedinUrl,
  });
  if (!enrichId) return null;

  return pollEnrichment(enrichId);
}
