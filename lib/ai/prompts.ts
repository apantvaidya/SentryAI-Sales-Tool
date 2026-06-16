import type { BuyerPersona, Person } from "@/lib/data/types";

export const smartSentryContext = `
Smart Sentry is an AI-powered security monitoring platform that helps organizations detect threats in real time using existing camera infrastructure and human-in-the-loop escalation. It moves teams from passive recording to proactive incident prevention.

Key value propositions:
- Real-time AI-assisted threat detection
- Works with existing cameras and security infrastructure
- Human-in-the-loop escalation for reliability
- Helps reduce guard dependence and monitoring fatigue
- Useful for distributed sites, logistics facilities, property managers, campuses, retail, municipalities, and enterprise security teams
- Emphasizes precision, reliability, and operational risk reduction
`;

export function companyResearchPrompt(input: {
  companyName: string;
  website?: string;
  industry?: string;
  notes?: string;
  segment?: string;
}) {
  return `
You are a careful B2B sales intelligence analyst for Smart Sentry. Generate a research brief using only the provided information and reasonable industry inference. Do not invent private facts or named employees.

${smartSentryContext}

Input:
- Company name: ${input.companyName}
- Website: ${input.website || "Not provided"}
- Industry: ${input.industry || "Not provided"}
- Notes: ${input.notes || "Not provided"}
- Target segment: ${input.segment || "Not provided"}

Return strict JSON:
{
  "summary": "...",
  "painPoints": ["..."],
  "securityRelevance": "...",
  "smartSentryFitScore": 0-100,
  "fitRationale": "...",
  "recommendedPersonas": [
    {
      "personaName": "Security Director",
      "roleTitles": ["Director of Security", "Head of Corporate Security"],
      "painPoints": ["..."],
      "valueProposition": "...",
      "objectionHandling": "...",
      "priorityScore": 0-100
    }
  ]
}
`;
}

export function personScoringPrompt(input: {
  person: Person;
  title: string;
  personas: BuyerPersona[];
}) {
  return `
Score this person for relevance to a Smart Sentry sales conversation.

Company: ${input.person.companyName}
Industry: ${input.person.companyIndustry || "Unknown"}
Title: ${input.title}
Buyer personas: ${input.personas.map((p) => `${p.personaName}: ${p.roleTitles.join(", ")}`).join(" | ")}

Return strict JSON:
{
  "confidenceScore": 0-100,
  "relevanceReason": "...",
  "bestPersonaMatch": "..."
}
`;
}

export function emailGenerationPrompt(input: {
  person: Person;
  persona?: BuyerPersona;
  tone: string;
  notes?: string;
}) {
  const { person } = input;
  return `
Write one high-quality, concise, manually reviewed B2B outreach email for Smart Sentry.

${smartSentryContext}

Company brief:
- Company: ${person.companyName}
- Website: ${person.companyWebsite || "Not provided"}
- Industry: ${person.companyIndustry || "Not provided"}
- Summary: ${person.companySummary || "Not generated"}
- Pain points: ${person.companyPainPoints.join("; ") || "Not generated"}
- Security relevance: ${person.companySecurityRelevance || "Not generated"}

Recipient:
- Name: ${person.name || "Unknown"}
- Title: ${person.title || "Unknown"}
- Email verified: ${person.emailVerified ? "Yes" : "No"}
- Persona: ${input.persona?.personaName || "Unknown"}
- Persona value proposition: ${input.persona?.valueProposition || "Not provided"}
- User notes: ${input.notes || "None"}
- Tone: ${input.tone}

Constraints:
- Do not imply the email is automated.
- Do not claim the recipient has a specific problem unless supplied.
- Avoid unverifiable ROI/statistical claims.
- Include a low-pressure CTA for review or a short call.

Return strict JSON:
{
  "subject": "...",
  "body": "...",
  "personalizationNotes": ["..."],
  "riskFlags": ["Avoid unsupported claims", "Verify contact email before sending"]
}
`;
}
