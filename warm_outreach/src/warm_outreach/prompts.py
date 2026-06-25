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
- 2 role-specific risk queries

Rules:
- Do not generate people or profile searches.
- Do not search for personal info.
- Do not search for contact information.
- Company context queries should target the company's operations, locations, facilities, and industry footprint.
- Role-specific risk queries should target operational challenges relevant to the lead's persona and likely site types.
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
  "role_specific_risk_queries": [
    "construction site after hours security monitoring equipment protection",
    "auto service center lot security vehicle monitoring after hours"
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
- Prefer operational language over sensational language.
- Mark whether geography is broad or specific through the geographic_confidence field.
- If evidence is weak, use cautious language.
- Preserve source URLs in source_urls.
- Focus safe_claims on company operational context and role-relevant challenges.
- Do not fabricate numbers, dates, or comparisons.
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
- Do not imply their company has suffered incidents.
- Tie the message to the person's role.
- Use tenure only if provided and natural.
- Be specific and personalized using the lead's actual role, company, tenure, and location or operating scope when available.
- Use "we" voice.
- Follow this structure closely, while keeping the final email natural and under 120 words:

Hi {{{{first_name}}}},
I saw you're {{{{current_title}}}} at {{{{company}}}}{{{{years_phrase}}}}.

{{{{experience_praise_sentence}}}}

SmartSentryAI is a computer vision physical security company with a simple mission: make solving crime cheaper and easier for organizations with real-world locations. We're trying to better understand how leaders like you think about {{{{relevant_issue_1}}}}, {{{{relevant_issue_2}}}}, and {{{{relevant_issue_3}}}} both at companies like {{{{company}}}} and in the broader {{{{area}}}} area.

Given your role in {{{{role_relevance}}}}, I thought your perspective would be especially valuable. Would you be open to a quick chat next week? I'd mainly love to hear how you're thinking about these problems and see if what we're building could be useful.

Best,
{{{{sender_name}}}}

- Fill the placeholders with concrete details from the lead and evidence. Do not leave placeholders in the output.
- `years_phrase` should be blank if tenure is missing, otherwise something natural like " and have been in the role for 1 yr 6 m".
- `role_relevance` should be a human phrase like "district asset protection", "construction operations", "physical security", or "regional operations", not the raw enum.
- `relevant_issue_1`, `relevant_issue_2`, and `relevant_issue_3` must be grounded in the persona and evidence.
- If no sender name is provided, use "SmartSentryAI".

- Generate `experience_praise_sentence` as a single sentence that acknowledges something specific and genuine about the lead's role or work.
- Use `current_role_description` (from the lead) as the primary source. Extract the most concrete responsibility, initiative, or achievement from it and frame it as a brief, natural compliment or congratulation.
- Good formats for `experience_praise_sentence` when `current_role_description` is present:
  - "Congrats on leading the {{specific_program_or_initiative}} — that kind of scope takes real operational discipline."
  - "Impressive work overseeing {{key_responsibility}} across {{company}} — the complexity there is no joke."
  - "The {{specific_initiative_or_achievement}} work sounds like a meaningful undertaking."
- Fallback when `current_role_description` is absent or empty: write a brief, role-appropriate professional acknowledgment such as:
  - "Congrats on the continued work in {{role_relevance}} — it's a space with a lot of operational nuance."
  - "Your background in {{role_relevance}} is exactly the kind of context we're trying to better understand."
- Keep the sentence concise (one sentence). Do not invent facts not present in the description.

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
