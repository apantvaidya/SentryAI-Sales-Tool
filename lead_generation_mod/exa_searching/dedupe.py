from __future__ import annotations

from typing import Any, TypeVar
from urllib.parse import urlparse, urlunparse
import re


T = TypeVar("T")


def normalize_text(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def canonicalize_linkedin_url(url: str | None) -> str | None:
    if not url:
        return None

    parsed = urlparse(url.strip())
    scheme = parsed.scheme or "https"
    host = parsed.netloc.lower()
    if host.startswith("www."):
        host = host[4:]

    if not host:
        return None

    segments = [segment for segment in parsed.path.split("/") if segment]
    if host.endswith("linkedin.com") and segments and segments[0] == "in":
        segments = segments[:2]

    path = "/" + "/".join(segments) if segments else "/"
    if path != "/" and path.endswith("/"):
        path = path.rstrip("/")

    return urlunparse((scheme, host, path, "", "", ""))


def normalize_name_company_key(full_name: str | None, company_name: str | None) -> str | None:
    normalized_name = normalize_text(full_name)
    normalized_company = normalize_text(company_name)
    if not normalized_name or not normalized_company:
        return None
    return f"{normalized_name}::{normalized_company}"


def title_family(title: str | None) -> str:
    normalized_title = normalize_text(title)
    if not normalized_title:
        return ""

    for family in (
        "asset protection",
        "loss prevention",
        "security",
        "operations",
        "facilities",
        "district",
        "regional",
        "store",
    ):
        if family in normalized_title:
            return family
    return normalized_title


def is_same_company_name(left: str | None, right: str | None) -> bool:
    return normalize_text(left) == normalize_text(right)


def record_completeness_score(record: Any) -> int:
    score = 0
    for field_name in (
        "full_name",
        "current_title",
        "current_company",
        "resolved_location",
        "linkedin_url",
        "public_business_email",
    ):
        if getattr(record, field_name, None):
            score += 1
    if getattr(record, "years_at_current_role", None) is not None:
        score += 1
    return score


def choose_more_complete(existing: T, incoming: T) -> T:
    existing_score = record_completeness_score(existing)
    incoming_score = record_completeness_score(incoming)

    if incoming_score > existing_score:
        return incoming
    if incoming_score < existing_score:
        return existing

    incoming_title_length = len(getattr(incoming, "current_title", "") or "")
    existing_title_length = len(getattr(existing, "current_title", "") or "")
    if incoming_title_length > existing_title_length:
        return incoming
    return existing


def are_probable_duplicates(left: Any, right: Any) -> bool:
    left_linkedin = canonicalize_linkedin_url(getattr(left, "linkedin_url", None))
    right_linkedin = canonicalize_linkedin_url(getattr(right, "linkedin_url", None))
    if left_linkedin and right_linkedin:
        return left_linkedin == right_linkedin

    left_secondary = normalize_name_company_key(
        getattr(left, "full_name", None),
        getattr(left, "current_company", None),
    )
    right_secondary = normalize_name_company_key(
        getattr(right, "full_name", None),
        getattr(right, "current_company", None),
    )
    if left_secondary and right_secondary and left_secondary == right_secondary:
        return True

    same_name = normalize_text(getattr(left, "full_name", None)) == normalize_text(
        getattr(right, "full_name", None)
    )
    same_company = is_same_company_name(
        getattr(left, "current_company", None),
        getattr(right, "current_company", None),
    )
    same_title_family = title_family(getattr(left, "current_title", None)) == title_family(
        getattr(right, "current_title", None)
    )
    return same_name and same_company and same_title_family


def _hit_count(record: Any) -> int:
    value = getattr(record, "query_hit_count", None)
    if value is None:
        return 1
    try:
        return max(int(value), 1)
    except (TypeError, ValueError):
        return 1


def _accumulate_hit_count(winner: Any, existing: Any, incoming: Any) -> None:
    """Sum the vector hit counts of both duplicates onto the winning record.

    PersonaLeadRecord is frozen, so use object.__setattr__; MappedCandidate is a
    plain dataclass and supports normal assignment. Records without the field
    (older payloads) are left untouched.
    """
    if not hasattr(winner, "query_hit_count"):
        return
    total = _hit_count(existing) + _hit_count(incoming)
    try:
        object.__setattr__(winner, "query_hit_count", total)
    except (AttributeError, TypeError):
        winner.query_hit_count = total


def dedupe_records(records: list[T]) -> list[T]:
    deduped: list[T] = []

    for record in records:
        match_index = next(
            (index for index, existing in enumerate(deduped) if are_probable_duplicates(existing, record)),
            None,
        )
        if match_index is None:
            deduped.append(record)
            continue
        existing = deduped[match_index]
        winner = choose_more_complete(existing, record)
        _accumulate_hit_count(winner, existing, record)
        deduped[match_index] = winner

    return deduped
