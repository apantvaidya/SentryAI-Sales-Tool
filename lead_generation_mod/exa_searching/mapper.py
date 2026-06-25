from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .models import MappedCandidate, RenderedQuery, clean_string


POSITIVE_ROLE_TERMS = (
    "asset protection",
    "loss prevention",
    "security",
    "operations",
    "facilities",
    "shrink",
)

NEGATIVE_ROLE_TERMS = (
    "advisor",
    "board",
    "consultant",
    "fractional",
)


def parse_partial_date(date_text: str | None) -> datetime | None:
    if not date_text:
        return None

    for fmt in ("%Y-%m-%d", "%Y-%m", "%Y"):
        try:
            return datetime.strptime(date_text, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def role_quality(job: dict[str, Any]) -> tuple[int, float]:
    title = clean_string(job.get("title")) or ""
    company_name = clean_string((job.get("company") or {}).get("name")) or ""
    title_lc = title.lower()

    score = 0
    if title:
        score += 1
    if company_name:
        score += 1
    if any(term in title_lc for term in POSITIVE_ROLE_TERMS):
        score += 1
    if any(term in title_lc for term in NEGATIVE_ROLE_TERMS):
        score -= 1

    start_date = parse_partial_date((job.get("dates") or {}).get("from"))
    date_score = start_date.timestamp() if start_date else float("-inf")
    return (score, date_score)


def select_most_recent_job(work_history: list[dict[str, Any]]) -> dict[str, Any] | None:
    def recency_key(job: dict[str, Any]) -> float:
        dates = job.get("dates") or {}
        end_date = parse_partial_date(dates.get("to"))
        start_date = parse_partial_date(dates.get("from"))
        target_date = end_date or start_date
        return target_date.timestamp() if target_date else float("-inf")

    dated_jobs = [job for job in work_history if recency_key(job) != float("-inf")]
    if dated_jobs:
        return sorted(dated_jobs, key=recency_key, reverse=True)[0]
    return work_history[0] if work_history else None


def calculate_years_at_role(start_text: str | None) -> float | None:
    start_date = parse_partial_date(start_text)
    if not start_date:
        return None

    elapsed_days = (datetime.now(timezone.utc) - start_date).days
    return round(elapsed_days / 365.25, 2)


def map_result_node(result_node: dict[str, Any], rendered_query: RenderedQuery) -> MappedCandidate | None:
    entities = result_node.get("entities") or []
    if not entities:
        return None

    entity = entities[0] or {}
    props = entity.get("properties") or {}
    work_history = props.get("workHistory") or []

    current_roles = [
        job
        for job in work_history
        if not clean_string((job.get("dates") or {}).get("to"))
    ]

    mapping_notes: list[str] = []
    used_recent_role_fallback = False

    if current_roles:
        current_job = sorted(current_roles, key=role_quality, reverse=True)[0]
        if len(current_roles) > 1:
            mapping_notes.append("multiple_current_roles")
    else:
        current_job = select_most_recent_job(work_history)
        if current_job is not None:
            used_recent_role_fallback = True
            mapping_notes.append("used_recent_role_fallback")

    if not current_job:
        return None

    resolved_location = clean_string(current_job.get("location")) or clean_string(props.get("location"))

    return MappedCandidate(
        full_name=props.get("name"),
        current_title=current_job.get("title"),
        current_company=(current_job.get("company") or {}).get("name"),
        years_at_current_role=calculate_years_at_role((current_job.get("dates") or {}).get("from")),
        resolved_location=resolved_location,
        linkedin_url=result_node.get("url"),
        public_business_email=None,
        current_role_description=current_job.get("description") or None,
        source_vector_id=rendered_query.vector_id,
        source_vector_name=rendered_query.vector_name,
        source_bucket=rendered_query.target_bucket,
        exa_result_id=result_node.get("id"),
        exa_result_url=result_node.get("url"),
        exa_entity_id=entity.get("id"),
        current_role_count=len(current_roles),
        used_recent_role_fallback=used_recent_role_fallback,
        work_history_count=len(work_history),
        mapping_notes=mapping_notes,
    )
