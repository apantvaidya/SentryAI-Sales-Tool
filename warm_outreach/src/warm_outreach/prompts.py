from __future__ import annotations

import json
from typing import Type

from pydantic import BaseModel

from .schemas import (
    EmailDraft,
    EvidenceSummary,
    Lead,
    LinkedInActivity,
    LinkedInMessageDraft,
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
- 2 professional interest queries

Rules:
- Do not generate personal-info or contact-info searches.
- Do not generate crime-stat or police-blotter queries.
- Do not search for personal info.
- Do not search for contact information.
- Company context queries should target the company's operations, locations, facilities, and industry footprint.
- Professional interest queries should target the themes this lead is likely to care about in their function, such as loss prevention, physical security, investigations, site operations, safety, or related leadership topics.
- These queries are for public context only. LinkedIn activity is gathered separately by the pipeline.
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
  "professional_interest_queries": [
    "construction leaders physical security site visibility incident review",
    "multi-site operations leaders safety asset protection monitoring"
  ]
}, indent=2)}

Target schema:
{_schema_block(ResearchQueries)}
""".strip()


def summarize_evidence_prompt(
    lead: Lead,
    persona: PersonaClassification,
    search_results: list[SearchResult],
    linkedin_activity: list[LinkedInActivity],
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
    serialized_linkedin_activity = [
        {
            "title": activity.title,
            "url": activity.url,
            "text": _trim_text(activity.text, 1000),
        }
        for activity in linkedin_activity[:5]
    ]
    return f"""
You are summarizing retrieved public evidence for SmartSentryAI warm outreach.

Rules:
- Only include claims supported by retrieved snippets or raw_content.
- You may also use the LinkedIn activity snippets below as public evidence of what the lead talks about, works on, or appears to care about.
- Prefer operational language over sensational language.
- Mark whether geography is broad or specific through the geographic_confidence field.
- If evidence is weak, use cautious language.
- Preserve source URLs in source_urls.
- Focus safe_claims on what this person appears to care about professionally, especially anything tied to loss prevention, asset protection, investigations, safety, physical security, or site operations.
- Set personalization_anchor to the single best concrete thing to reference in the email.
- Only use a LinkedIn item as the personalization_anchor if it looks like a real, specific, mention-worthy post or activity item.
- If the LinkedIn material is generic, thin, boilerplate, or not clearly worth citing in outreach, leave personalization_anchor as null or use a safer non-post anchor from the lead's role/description.
- Do not fabricate numbers, dates, or comparisons.
- Return strict JSON only matching the schema.

Lead:
{_json_block(lead)}

Persona classification:
{_json_block(persona)}

Retrieved search results:
{_json_block(serialized_results)}

LinkedIn activity:
{_json_block(serialized_linkedin_activity)}

Target schema:
{_schema_block(EvidenceSummary)}
""".strip()


def write_email_prompt(
    lead: Lead,
    persona: PersonaClassification,
    evidence: EvidenceSummary,
    linkedin_activity: list[LinkedInActivity] | None = None,
) -> str:
    activity = linkedin_activity or []
    if activity:
        def is_post_candidate(item: LinkedInActivity) -> bool:
            url = (item.url or "").lower()
            return any(part in url for part in ("/posts/", "/feed/update/", "/pulse/"))

        post_candidates = [item for item in activity if is_post_candidate(item)]
        non_post_activity = [item for item in activity if not is_post_candidate(item)]

        posts_block = "\n\n".join(
            (
                f"Post candidate {i + 1}:\n"
                f"Title: {item.title or 'N/A'}\n"
                f"URL: {item.url or 'N/A'}\n"
                f"Text: {item.text}"
            )
            for i, item in enumerate(post_candidates[:3])
        ) or "None"
        other_activity_block = "\n\n".join(
            (
                f"Other activity {i + 1}:\n"
                f"Title: {item.title or 'N/A'}\n"
                f"URL: {item.url or 'N/A'}\n"
                f"Text: {item.text}"
            )
            for i, item in enumerate(non_post_activity[:2])
        ) or "None"

        linkedin_section = f"""
LinkedIn post candidates (prefer these if one is concrete and worth mentioning):
{posts_block}

Other LinkedIn activity (use only if there is no good specific post to mention):
{other_activity_block}
"""
    else:
        linkedin_section = ""

    return f"""
You are writing a short, grounded warm outreach email for SmartSentryAI.

Rules:
- Under 110 words.
- Warm, direct, natural.
- Make it feel personal and handwritten, not corporate or templated.
- Do not imply their company has suffered incidents.
- Do not mention crime stats, police data, or neighborhood crime levels.
- Tie the message to the person's role and what they have shared or seem to care about.
- Use tenure only if provided and natural.
- Be specific and personalized using the lead's actual role, company, tenure, and LinkedIn activity when available.
- Prefer first-person singular voice: "I", "me", and "my".
- It is okay to use one brief "we're building..." sentence when describing the company.
- Follow this structure closely, while keeping the final email natural and under 120 words:

Hi {{{{first_name}}}},
I came across your work as {{{{current_title}}}} at {{{{company}}}}{{{{years_phrase}}}}.

{{{{linkedin_reference_sentence}}}}

Given your experience in {{{{role_relevance}}}}, I'd love to chat and share notes. We're building Agentic Security solutions to reduce pressure on security teams, and I'd be interested to hear how you think about {{{{relevant_focus_1}}}} and {{{{relevant_focus_2}}}}.

Would you be open to a quick conversation next week?

Best,
{{{{sender_name}}}}

- Fill the placeholders with concrete details from the lead and evidence. Do not leave placeholders in the output.
- `years_phrase` should be blank if tenure is missing, otherwise something natural like " and have been in the role for 1 yr 6 m".
- `role_relevance` should be a human phrase like "district asset protection", "construction operations", "physical security", or "regional operations", not the raw enum.
- `relevant_focus_1` and `relevant_focus_2` must be grounded in the persona and evidence.
- If no sender name is provided, use "SmartSentryAI".
- Work in this positioning naturally: "We're building Agentic Security solutions to reduce pressure on security teams."
- Keep that line concise and human. Do not let it sound like marketing copy.

- Generate `linkedin_reference_sentence` as a single sentence that acknowledges something specific and genuine about the lead's role, work, or professional interests.
- Only reference a specific LinkedIn post if it is clearly good enough to mention.
- A LinkedIn post is good enough to mention only when it contains a concrete topic, initiative, milestone, opinion, or project that a human sender would naturally cite in a cold email.
- Do not force a post reference when the available LinkedIn text is generic profile copy, a repost without substance, vague leadership boilerplate, scraped navigation junk, or anything too thin to cite confidently.
- If a good post exists, explicitly reference that specific post or topic in natural language. Example: "I saw your recent post about reducing shrink through better field execution, and it really stood out."
- If no good post exists, do not mention LinkedIn posts at all. Fall back to the default acknowledgment text path instead.
- Priority order for sourcing the sentence:
  1. A good specific LinkedIn post candidate (if provided below) — pick one concrete project, milestone, opinion, initiative, or loss-prevention-related topic they shared and reference it naturally.
  2. `current_role_description` (from the lead) — extract the most concrete responsibility or achievement. Example: "Congrats on leading the {{specific_program}} — that kind of scope takes real operational discipline."
  3. `personalization_anchor` from the evidence summary if useful.
  4. Fallback (no activity and no description): a brief role-appropriate acknowledgment. Example: "Your background in {{role_relevance}} really stood out to us."
- Keep the sentence concise (one sentence). Do not invent facts.
{linkedin_section}
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


def write_linkedin_message_prompt(
    lead: Lead,
    persona: PersonaClassification,
    evidence: EvidenceSummary,
    linkedin_activity: list[LinkedInActivity] | None = None,
) -> str:
    activity = linkedin_activity or []
    if activity:
        activity_block = "\n\n".join(
            (
                f"LinkedIn item {i + 1}:\n"
                f"Title: {item.title or 'N/A'}\n"
                f"URL: {item.url or 'N/A'}\n"
                f"Text: {item.text}"
            )
            for i, item in enumerate(activity[:3])
        )
    else:
        activity_block = "None"

    return f"""
You are writing a short LinkedIn connection or follow-up message for SmartSentryAI.

Rules:
- Maximum 450 characters.
- No subject line.
- Personal, warm, handwritten, and concise.
- Prefer first-person singular voice.
- It is okay to use one brief "we're building..." sentence when describing the company.
- Do not sound salesy, polished, or automated.
- Do not mention crime stats, police data, or unsupported incidents.
- If there is a genuinely mention-worthy LinkedIn post or activity item, reference it briefly and naturally.
- If there is not, use a simple role-based acknowledgment instead.
- Include this positioning naturally: "we're building Agentic Security solutions to reduce pressure on security teams."
- End with a light ask, not a hard sell.

Suggested structure:
Hi {{{{first_name}}}} - noticed your work in {{{{role_relevance}}}} at {{{{company}}}}.
{{{{linkedin_reference_or_acknowledgment}}}}
I'm reaching out because we're building Agentic Security solutions to reduce pressure on security teams.
Would love to compare notes sometime if you're open.

Lead:
{_json_block(lead)}

Persona classification:
{_json_block(persona)}

Evidence summary:
{_json_block(evidence)}

LinkedIn activity:
{activity_block}

Target schema:
{_schema_block(LinkedInMessageDraft)}
""".strip()
