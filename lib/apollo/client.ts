type ApolloMatchResponse = {
  person?: {
    email?: string;
  };
};

async function apolloMatch(params: Record<string, string>, apiKey: string): Promise<string | null> {
  const url = new URL("https://api.apollo.io/api/v1/people/match");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  try {
    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Api-Key": apiKey,
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    const data: ApolloMatchResponse = await response.json();
    return data.person?.email ?? null;
  } catch {
    return null;
  }
}

export async function findEmailWithApollo(params: {
  firstName: string;
  lastName: string;
  domain: string;
  linkedinUrl?: string;
}): Promise<string | null> {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) return null;

  // LinkedIn URL lookup is the most accurate — try it first when available
  if (params.linkedinUrl) {
    const email = await apolloMatch({ linkedin_url: params.linkedinUrl }, apiKey);
    if (email) return email;
  }

  // Fall back to name + domain
  return apolloMatch({
    first_name: params.firstName,
    last_name: params.lastName,
    domain: params.domain,
  }, apiKey);
}
