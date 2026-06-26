from __future__ import annotations

import csv
import json
from pathlib import Path

from .config import settings
from .llm import call_json
from .prompts import (
    classify_lead_prompt,
    generate_research_queries_prompt,
    summarize_evidence_prompt,
    write_email_prompt,
    write_linkedin_message_prompt,
)
from .schemas import (
    EmailDraft,
    EvidenceSummary,
    Lead,
    LinkedInActivity,
    LinkedInMessageDraft,
    PersonaClassification,
    PipelineOutput,
    ResearchQueries,
)
from .search import fetch_linkedin_activity_via_exa, run_searches
from .validators import validate_email


def _normalize_row(row: dict[str, str]) -> dict[str, str | None]:
    normalized: dict[str, str | None] = {}
    for key, value in row.items():
        if value is None:
            normalized[key] = None
            continue
        stripped = value.strip()
        normalized[key] = stripped or None
    return normalized


def classify_lead(lead: Lead) -> PersonaClassification:
    return call_json(classify_lead_prompt(lead), PersonaClassification)


def generate_research_queries(lead: Lead, persona: PersonaClassification) -> ResearchQueries:
    return call_json(generate_research_queries_prompt(lead, persona), ResearchQueries)


def summarize_evidence(
    lead: Lead,
    persona: PersonaClassification,
    search_results,
    linkedin_activity: list[LinkedInActivity] | None = None,
) -> EvidenceSummary:
    return call_json(
        summarize_evidence_prompt(lead, persona, search_results, linkedin_activity or []),
        EvidenceSummary,
    )


def write_email(
    lead: Lead,
    persona: PersonaClassification,
    evidence: EvidenceSummary,
    linkedin_activity: list[LinkedInActivity] | None = None,
) -> EmailDraft:
    return call_json(write_email_prompt(lead, persona, evidence, linkedin_activity or []), EmailDraft)


def write_linkedin_message(
    lead: Lead,
    persona: PersonaClassification,
    evidence: EvidenceSummary,
    linkedin_activity: list[LinkedInActivity] | None = None,
) -> LinkedInMessageDraft:
    return call_json(
        write_linkedin_message_prompt(lead, persona, evidence, linkedin_activity or []),
        LinkedInMessageDraft,
    )


def _evidence_source_fallbacks(
    lead: Lead,
    search_results,
    linkedin_activity: list[LinkedInActivity],
) -> list[str]:
    urls: list[str] = []
    if lead.linkedin:
        urls.append(lead.linkedin)
    urls.extend(activity.url for activity in linkedin_activity if activity.url)
    urls.extend(result.url for result in search_results if result.url)

    deduped: list[str] = []
    seen: set[str] = set()
    for url in urls:
        if url and url not in seen:
            seen.add(url)
            deduped.append(url)
    return deduped


def run_pipeline_for_lead(
    lead: Lead,
    *,
    max_results: int | None = None,
    include_raw_content: bool = False,
) -> PipelineOutput:
    persona = classify_lead(lead)
    queries = generate_research_queries(lead, persona)
    search_results = run_searches(
        queries,
        max_results=max_results or settings.tavily_max_results,
        include_raw_content=include_raw_content,
    )
    linkedin_activity = fetch_linkedin_activity_via_exa(lead)
    evidence_summary = summarize_evidence(lead, persona, search_results, linkedin_activity)
    if not evidence_summary.source_urls:
        evidence_summary = evidence_summary.model_copy(
            update={"source_urls": _evidence_source_fallbacks(lead, search_results, linkedin_activity)}
        )
    email = write_email(lead, persona, evidence_summary, linkedin_activity)
    linkedin_message = write_linkedin_message(lead, persona, evidence_summary, linkedin_activity)
    validation = validate_email(email, evidence_summary)

    return PipelineOutput(
        lead=lead,
        persona=persona,
        queries=queries,
        search_results=search_results,
        linkedin_activity=linkedin_activity,
        evidence_summary=evidence_summary,
        email=email,
        linkedin_message=linkedin_message,
        validation=validation,
    )


def prepare_queries_for_lead(lead: Lead) -> dict[str, object]:
    persona = classify_lead(lead)
    queries = generate_research_queries(lead, persona)
    return {
        "lead": lead.model_dump(mode="json"),
        "persona": persona.model_dump(mode="json"),
        "queries": queries.model_dump(mode="json"),
    }


def run_pipeline_for_csv(
    input_csv: str,
    output_jsonl: str,
    *,
    max_results: int | None = None,
    include_raw_content: bool = False,
) -> None:
    input_path = Path(input_csv)
    output_path = Path(output_jsonl)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with input_path.open("r", encoding="utf-8", newline="") as infile:
        reader = csv.DictReader(infile)
        leads = [Lead.model_validate(_normalize_row(row)) for row in reader]

    with output_path.open("w", encoding="utf-8") as outfile:
        for lead in leads:
            result = run_pipeline_for_lead(
                lead,
                max_results=max_results,
                include_raw_content=include_raw_content,
            )
            outfile.write(json.dumps(result.model_dump(mode="json")) + "\n")


def prepare_queries_for_csv(input_csv: str) -> list[dict[str, object]]:
    input_path = Path(input_csv)
    with input_path.open("r", encoding="utf-8", newline="") as infile:
        reader = csv.DictReader(infile)
        leads = [Lead.model_validate(_normalize_row(row)) for row in reader]
    return [prepare_queries_for_lead(lead) for lead in leads]
