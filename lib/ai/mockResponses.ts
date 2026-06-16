import type { BuyerPersona, Person } from "@/lib/data/types";

export function mockResearchBrief(input: {
  companyName: string;
  website?: string;
  industry?: string;
  notes?: string;
  segment?: string;
}) {
  const segment = input.segment || input.industry || "distributed operations";
  return {
    summary: `${input.companyName} appears to be a strong Smart Sentry research target in ${segment}. Based on the provided inputs, the most relevant conversation is around improving visibility across physical sites without replacing existing camera investments.`,
    painPoints: [
      "Security teams may be reviewing too much passive footage after incidents occur.",
      "Distributed locations can make consistent monitoring and escalation difficult.",
      "Guard teams and operators can experience alert fatigue during long monitoring windows.",
      "Leadership may need clearer operational evidence before expanding security spend."
    ],
    securityRelevance: `Smart Sentry is relevant because it can layer AI-assisted threat detection and human-in-the-loop escalation onto existing camera infrastructure for ${segment} environments.`,
    smartSentryFitScore: input.segment?.includes("logistics") ? 88 : 82,
    fitRationale: "High fit when the organization has physical sites, camera coverage, and a need to move from reactive review to proactive incident response.",
    recommendedPersonas: [
      {
        personaName: "Security Director",
        roleTitles: ["Director of Security", "Head of Corporate Security", "Physical Security Manager"],
        painPoints: ["Reducing incident response time", "Improving monitoring coverage", "Avoiding unreliable alerts"],
        valueProposition: "Turn existing cameras into a proactive detection and escalation layer without forcing a rip-and-replace project.",
        objectionHandling: "Start with a focused pilot on high-risk cameras and measure escalation quality before broader rollout.",
        priorityScore: 94
      },
      {
        personaName: "Operations Leader",
        roleTitles: ["VP Operations", "Regional Operations Director", "Facilities Director"],
        painPoints: ["Site consistency", "Operational disruptions", "Labor constraints"],
        valueProposition: "Reduce operational risk across multiple sites by detecting issues earlier and escalating only meaningful events.",
        objectionHandling: "Position Smart Sentry as operational risk reduction, not another tool for the security team to babysit.",
        priorityScore: 86
      },
      {
        personaName: "IT / Infrastructure Owner",
        roleTitles: ["IT Director", "Infrastructure Manager", "Systems Administrator"],
        painPoints: ["Integration burden", "Vendor security", "Camera infrastructure complexity"],
        valueProposition: "Use current camera infrastructure while keeping deployment scope clear, reviewable, and operationally reliable.",
        objectionHandling: "Lead with compatibility discovery, access controls, and a staged deployment plan.",
        priorityScore: 73
      }
    ]
  };
}

export function mockPersonScore(input: { person: Person; title: string; personas: BuyerPersona[] }) {
  const title = input.title.toLowerCase();
  const persona =
    input.personas.find((item) =>
      item.roleTitles.some((role) => title.includes(role.toLowerCase().split(" ")[0]))
    ) || input.personas[0];
  const score = title.includes("security") ? 92 : title.includes("operations") || title.includes("facilities") ? 84 : 68;
  return {
    confidenceScore: score,
    relevanceReason: `${input.title} likely has influence over physical security monitoring, site risk, or operational escalation decisions at ${input.person.companyName}.`,
    bestPersonaMatch: persona?.personaName || "Security Director"
  };
}

export function mockEmail(input: {
  person: Person;
  tone: string;
}) {
  const company = input.person.companyName;
  const firstName = input.person.name?.split(" ")[0] || "there";
  const angle =
    input.person.companySecurityRelevance ||
    "Smart Sentry helps teams turn existing cameras into a proactive detection and escalation layer.";
  return {
    subject: `${company} security monitoring idea`,
    body: `Hi ${firstName},\n\nI’m reaching out because ${company} looks like the kind of organization where physical security teams may need more than passive video review. ${angle}\n\nSmart Sentry uses AI-assisted detection with human-in-the-loop escalation, so teams can focus on meaningful incidents while continuing to use existing camera infrastructure.\n\nWould it be useful to compare notes on where proactive monitoring could reduce response time or operator fatigue for your team?\n\nBest,\nSmart Sentry team`,
    personalizationNotes: [
      `Review whether ${input.person.title || "this contact"} owns security monitoring or site operations.`,
      `Add one verified detail about ${company} before sending.`,
      `Confirm the email address manually before export or outreach.`
    ],
    riskFlags: ["Avoid unsupported claims", "Verify contact email before sending", "Confirm the recipient owns this problem area"]
  };
}
