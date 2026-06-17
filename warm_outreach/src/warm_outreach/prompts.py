from __future__ import annotations

import json
from typing import Type

from pydantic import BaseModel

from .schemas import (
    EmailDraft,
    EvidenceSummary,
    Lead,
    PersonaClassification,
    ResearchQueries,
    SearchResult,
)


def _schema_block(model: Type[BaseModel]) -> str:
    return json.dumps(model.model_json_schema(), indent=2)


def _json_block(payload: object) -> str:
    if isinstance(payload, BaseModel):
        return payload.model_dump_json(indent=2)
    return json.dumps(payload, indent=2)


def _trim_text(value: str | None, limit: int) -> str | None:
    if value is None:
        return None
    compact = " ".join(value.split())
    if len(compact) <= limit:
        return compact
    return compact[: limit - 3] + "..."


def classify_lead_prompt(lead: Lead) -> str:
    return f"""
You are classifying a B2B lead for SmartSentryAI warm outreach.

Use only the lead row below.
Do not search for the person.
Do not infer private facts.
Classify based only on title, company, location, and role tenure.
For Tesla Staff Construction Manager, classify as construction / physical site operations, not retail loss prevention.
Return strict JSON only matching the schema.

Lead:
{_json_block(lead)}

Target schema:
{_schema_block(PersonaClassification)}
""".strip()


def generate_research_queries_prompt(lead: Lead, persona: PersonaClassification) -> str:
    return f"""
You are generating public web research queries for SmartSentryAI warm outreach.

Generate exactly:
- 2 company context queries
- 2 local crime/public safety queries
- 2 recent incident queries
- 2 role-specific risk queries

Rules:
- Do not generate people or profile searches.
- Do not search for personal info.
- Do not search for contact information.
- Prefer official company, city, county, police, FBI, and reputable sources.
- For local crime/public safety, make one query target official city/county/police data dashboards or reports with numeric statistics.
- Make the second local crime/public safety query target a recent relevant incident or pattern in the same area.
- Recent incident queries must search for specific public incidents from the last few months that match the lead's role and likely sites.
- For construction/facilities roles, recent incident queries should target construction site theft, equipment theft, copper theft, trespass, burglary, vandalism, or after-hours site access.
- For asset protection/loss prevention/retail roles, recent incident queries should target retail theft, shoplifting, organized retail theft, robbery, burglary, or store safety incidents.
- For physical security/operations roles, recent incident queries should target trespass, burglary, vandalism, lot activity, theft, robbery, or public-safety incidents relevant to multi-site operations.
- Include recency language such as "recent", "last month", "2026", or "past few months" in recent incident queries.
- If location is missing, use company + role-specific risk queries and set local crime queries to broader company footprint or industry risk.
- If location is missing, recent incident queries should use the company footprint, metro/state, or industry context without implying a specific local site.
- Return strict JSON only matching the schema.

Lead:
{_json_block(lead)}

Persona classification:
{_json_block(persona)}

Example for Tesla + Staff Construction Manager + Bay Area:
{json.dumps({
  "company_context_queries": [
    "Tesla service centers charging sites facilities construction operations",
    "Tesla physical locations service centers facilities operations"
  ],
  "local_crime_queries": [
    "Bay Area police crime data theft burglary vehicle theft",
    "Santa Clara County crime dashboard property crime vehicle theft burglary"
  ],
  "recent_incident_queries": [
    "recent Bay Area construction site theft equipment theft copper theft 2026",
    "recent Santa Clara County commercial burglary construction site trespass theft"
  ],
  "role_specific_risk_queries": [
    "construction site theft trespassing equipment theft after hours security",
    "auto service center lot security vehicle break-ins after hours monitoring"
  ]
}, indent=2)}

Target schema:
{_schema_block(ResearchQueries)}
""".strip()


def summarize_evidence_prompt(
    lead: Lead,
    persona: PersonaClassification,
    search_results: list[SearchResult],
) -> str:
    serialized_results = [
        {
            "query": result.query,
            "title": result.title,
            "url": result.url,
            "source_type": result.source_type,
            "confidence": result.confidence,
            "snippet": _trim_text(result.snippet, 700),
            "raw_content": _trim_text(result.raw_content, 1200),
        }
        for result in search_results[:18]
    ]
    return f"""
You are summarizing retrieved public evidence for SmartSentryAI warm outreach.

Rules:
- Only include claims supported by retrieved snippets or raw_content.
- Do not claim the lead's company experienced crime unless explicitly supported.
- Do not claim the lead's exact location or site is unsafe.
- Prefer operational language over fear-based language.
- Mark whether geography is broad or specific through the geographic_confidence field.
- If evidence is weak, use cautious language.
- Preserve source URLs in source_urls.
- When public-safety or crime context exists, prefer including one specific, supported local or regional risk in safe_claims, such as property crime, vehicle theft, burglary, trespassing, or copper theft.
- Prefer recent, role-relevant incidents from recent_incident_queries when they are source-backed, especially incidents from the past few months.
- For construction and facilities personas, prefer concrete risks like after-hours access, trespass, equipment theft, material theft, copper theft, or lot activity when supported by sources.
- Distinguish between company-context claims and public-safety-context claims.
- Prefer official government sources and reputable local news over generic vendor blogs or social pages.
- If a numeric local statistic is available, include at least one safe claim with the number and timeframe.
- If a recent relevant incident is available, include at least one safe claim with the date/month/year, geography, and incident type.
- Recent incident claims must be phrased as public local/regional context, not as incidents involving the lead's company unless the source explicitly says so.
- Do not fabricate numbers, dates, trend direction, or comparisons.
- Return strict JSON only matching the schema.

Lead:
{_json_block(lead)}

Persona classification:
{_json_block(persona)}

Retrieved search results:
{_json_block(serialized_results)}

Target schema:
{_schema_block(EvidenceSummary)}
""".strip()


def write_email_prompt(
    lead: Lead,
    persona: PersonaClassification,
    evidence: EvidenceSummary,
) -> str:
    return f"""
You are writing a short, grounded warm outreach email for SmartSentryAI.

Rules:
- Under 110 words.
- Warm, direct, natural.
- Do not say "we know your area has crime."
- Do not imply their company has suffered incidents.
- Do not use fear-based language.
- Tie the message to the person's role.
- Use tenure only if provided and natural.
- Be specific and personalized using the lead's actual role, company, tenure, and location or operating scope when available.
- Use the evidence summary to include a concrete, supported local risk or operational issue.
- Prefer a recent, source-backed specific incident when one is available and relevant to the person's role.
- If geography is supported only broadly, say so in broad terms such as "Austin/Travis County reporting" rather than implying the exact site had incidents.
- You must mention at least one concrete local or regional risk or public-safety issue from evidence.safe_claims when evidence confidence is medium or high.
- Use "we" voice.
- Follow this structure closely, while keeping the final email natural and under 120 words:

Hi {{{{first_name}}}},
I saw you're {{{{current_title}}}} at {{{{company}}}}{{{{years_phrase}}}}.

{{{{crime_stat_sentence}}}}

SmartSentryAI is a computer vision physical security company with a simple mission: make solving crime cheaper and easier for organizations with real-world locations. We're trying to better understand how leaders like you think about {{{{relevant_issue_1}}}}, {{{{relevant_issue_2}}}}, and {{{{relevant_issue_3}}}} both at companies like {{{{company}}}} and in the broader {{{{area}}}} area.

Given your role in {{{{role_relevance}}}}, I thought your perspective would be especially valuable. Would you be open to a quick chat next week? I'd mainly love to hear how you're thinking about these problems and see if what we're building could be useful.

Best,
{{{{sender_name}}}}

- Fill the placeholders with concrete details from the lead and evidence. Do not leave placeholders in the output.
- `years_phrase` should be blank if tenure is missing, otherwise something natural like " and have been in the role for 1 yr 6 m".
- `role_relevance` should be a human phrase like "district asset protection", "construction operations", "physical security", or "regional operations", not the raw enum.
- `relevant_issue_1`, `relevant_issue_2`, and `relevant_issue_3` must be grounded in the persona and evidence.
- If no sender name is provided, use "SmartSentryAI".

- Generate `crime_stat_sentence` using public, source-backed crime or security data relevant to the lead's role, company type, and location.
- Prioritize recent stats or recent specific incidents from the last few months.

- Role-to-stat matching:
  - Asset Protection / Loss Prevention:
    Use retail theft, shoplifting, organized retail crime, commercial burglary, shrink, repeat theft, robbery, or store safety stats.
  - Construction:
    Use construction site theft, equipment theft, copper theft, material theft, trespass, burglary, vandalism, after-hours property crime, or commercial theft incidents/stats.
  - Facilities:
    Use burglary, vandalism, trespass, after-hours incidents, property crime, or facility security stats.
  - Physical Security / Security Operations:
    Use robbery, burglary, trespass, vandalism, property crime, incident response, or public safety trends.
  - Operations / Regional / District Leadership:
    Use multi-site relevant risks such as theft, burglary, safety incidents, property crime, or recurring incident patterns.

- Geography rules:
  - Prefer the lead's exact city or county if available and supported.
  - If exact city or county data is unavailable, use the broader county, metro, or state, but clearly say so.
  - Do not imply the stat applies to the prospect's exact stores, sites, or facilities unless the source explicitly supports that.
  - Do not claim the company has experienced incidents unless the source explicitly says so.
  - If only statewide data is available, phrase it as statewide rather than implying it is local.
  - If only national data is available, use it only when it is highly industry-specific and clearly label it as national.

- Tone rules for `crime_stat_sentence`:
  - Keep it to one sentence when possible.
  - Use neutral wording like "reported," "tracked," "found," or "public data shows."
  - Avoid fear-based language like "dangerous," "crime-ridden," "unsafe," "crisis," or "out of control."
  - Do not write "we know your area has crime."
  - Do not overstate certainty.
  - Do not include more than two stats in the sentence.
  - If the stat is broad, connect it to the role carefully.

- Good formats for `crime_stat_sentence`:
  - "Retail theft seems especially relevant for AP teams in {{area}} right now: {{source}} reported {{specific_stat}}, while {{second_source}} found {{specific_stat}}."
  - "For {{industry}} operators in {{area}}, {{crime_category}} is a relevant issue: {{source}} reported {{specific_stat}} in {{time_period}}."
  - "A recent {{area}} report about {{incident_type}} seemed relevant to {{role_relevance}} teams because it involved {{operational_risk}}."
  - "Recent local reporting in {{area}} described {{incident_type}}, which maps to practical concerns like {{operational_risk}} and after-hours visibility."
  - "Public safety data in {{area}} points to recurring {{crime_category}} issues, with {{source}} reporting {{specific_stat}}."
  - "At the statewide level, {{source}} reported {{specific_stat}}, which seemed relevant given your work in {{role_relevance}}."
  - "For {{persona_type}} teams, {{crime_category}} is a concrete operating concern: {{source}} reported {{specific_stat}} in {{area_or_scope}}."

- Bad formats for `crime_stat_sentence`:
  - "We know your area is dealing with crime."
  - "Your stores are probably facing theft."
  - "{{company}} locations are at risk."
  - "Crime is exploding in your area."
  - "This is a huge problem for you."
  - "You need AI security because crime is rising."

- Fallback behavior for `crime_stat_sentence`:
  - If there is no reliable role- and location-relevant stat, use a cautious industry-level sentence.
  - If there is no reliable stat at all, omit the sentence body by using a cautious neutral sentence grounded in public security context and keep the final email reviewable.
  - Never invent numbers.
  - Never cite a source that was not retrieved.
  - Never use a stat if the source geography, timeframe, or crime category is unclear.

- Return strict JSON only matching the schema.

Lead:
{_json_block(lead)}

Persona classification:
{_json_block(persona)}

Evidence summary:
{_json_block(evidence)}

Grounded product context:
{json.dumps({
  "sender_name": "SmartSentryAI",
  "rules": [
    "Do not invent deployments, customer counts, outcomes, or named customer relationships."
  ]
}, indent=2)}

Target schema:
{_schema_block(EmailDraft)}
""".strip()
