import { companyResearchPrompt, personScoringPrompt, emailGenerationPrompt } from "./prompts";
import { mockPersonScore, mockEmail, mockResearchBrief } from "./mockResponses";
import type { BuyerPersona, DraftTone, Person } from "@/lib/data/types";

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

export async function scorePersonRelevance(input: {
  person: Person;
  title: string;
  personas: BuyerPersona[];
}) {
  return requestJson(personScoringPrompt(input), mockPersonScore(input));
}

export async function generatePersonalizedEmail(input: {
  person: Person;
  persona?: BuyerPersona;
  tone: DraftTone;
  notes?: string;
}) {
  return requestJson(emailGenerationPrompt(input), mockEmail({ person: input.person, tone: input.tone }));
}
