import { companyResearchPrompt, contactScoringPrompt, emailGenerationPrompt } from "./prompts";
import { mockContactScore, mockEmail, mockResearchBrief } from "./mockResponses";
import type { BuyerPersona, Contact, Prospect, ProspectWorkspace } from "@/lib/data/types";

const model = "gpt-4o-mini";

function hasApiKey() {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function isDemoMode() {
  return !hasApiKey();
}

async function requestJson<T>(prompt: string, fallback: T): Promise<T> {
  if (!hasApiKey()) return fallback;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "You return only valid JSON. You are careful, factual, and avoid unsupported claims."
          },
          { role: "user", content: prompt }
        ]
      })
    });

    if (!response.ok) return fallback;
    const json = await response.json();
    const content = json.choices?.[0]?.message?.content;
    if (!content) return fallback;
    return JSON.parse(content) as T;
  } catch {
    return fallback;
  }
}

export async function generateCompanyResearch(input: {
  companyName: string;
  website?: string;
  industry?: string;
  notes?: string;
  segment?: string;
}) {
  return requestJson(companyResearchPrompt(input), mockResearchBrief(input));
}

export async function scoreContactRelevance(input: {
  prospect: Prospect;
  contactTitle: string;
  personas: BuyerPersona[];
}) {
  return requestJson(contactScoringPrompt(input), mockContactScore(input));
}

export async function generatePersonalizedEmail(input: {
  workspace: ProspectWorkspace;
  contact?: Contact;
  persona?: BuyerPersona;
  tone: "concise" | "executive" | "technical" | "warm";
  notes?: string;
}) {
  return requestJson(
    emailGenerationPrompt(input),
    mockEmail({
      workspace: input.workspace,
      contactName: input.contact?.name,
      contactTitle: input.contact?.title,
      personaName: input.persona?.personaName,
      tone: input.tone
    })
  );
}
