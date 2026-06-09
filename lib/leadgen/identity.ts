export function normalizeText(value?: string | null) {
  return (value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function normalizeLinkedinUrl(value?: string | null) {
  if (!value) return undefined;
  try {
    const withProtocol = value.includes("://") ? value : `https://${value}`;
    const url = new URL(withProtocol);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    const segments = url.pathname.split("/").filter(Boolean);
    const path = host.endsWith("linkedin.com") && segments[0] === "in" ? `/in/${segments[1] || ""}` : `/${segments.join("/")}`;
    return `https://${host}${path.replace(/\/$/, "")}`;
  } catch {
    return value.trim().toLowerCase();
  }
}

export function normalizeNameCompany(fullName?: string | null, company?: string | null) {
  const name = normalizeText(fullName);
  const normalizedCompany = normalizeText(company);
  return `${name}::${normalizedCompany}`;
}

export function candidateIdentity(input: { linkedinUrl?: string | null; fullName?: string | null; currentCompany?: string | null }) {
  const linkedin = normalizeLinkedinUrl(input.linkedinUrl);
  if (linkedin) {
    return { identityKey: linkedin, identityKeyType: "linkedinUrl" as const };
  }
  return {
    identityKey: normalizeNameCompany(input.fullName, input.currentCompany),
    identityKeyType: "nameCompany" as const
  };
}
