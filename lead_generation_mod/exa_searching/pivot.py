from __future__ import annotations

from .dedupe import normalize_text
from .mapper import NEGATIVE_ROLE_TERMS, POSITIVE_ROLE_TERMS
from .models import PersonaLeadRecord, SeedPersona


COMPANY_NOVELTY_BONUS = 10.0
QUERY_FREQUENCY_PENALTY_WEIGHT = 2.0


def role_fidelity_score(candidate_title: str | None, original_seed_role: str | None) -> int:
    """Score how closely a candidate's title matches the original seed's role.

    Anchored to the *original* seed role (not the intermediate pivot) to prevent
    persona drift across hops. Reuses the keyword lists from ``mapper.py``:
    a positive term counts only when it is present in both the candidate title and
    the original seed role. When the seed role carries no canonical term we fall
    back to matching positive terms in the candidate title alone, so the signal
    still works for loosely-worded seed roles.
    """
    title = (candidate_title or "").lower()
    seed = (original_seed_role or "").lower()

    seed_terms = [term for term in POSITIVE_ROLE_TERMS if term in seed]
    if seed_terms:
        positive = sum(1 for term in seed_terms if term in title)
    else:
        positive = sum(1 for term in POSITIVE_ROLE_TERMS if term in title)

    score = min(positive, 2)
    if any(term in title for term in NEGATIVE_ROLE_TERMS):
        score -= 1
    return max(0, min(3, score))


def completeness_score(record: PersonaLeadRecord) -> int:
    score = 0
    if record.linkedin_url:
        score += 1
    if record.current_title:
        score += 1
    if record.current_company:
        score += 1
    return score


def score_pivot_candidate(
    candidate: PersonaLeadRecord,
    original_seed_role: str | None,
    seen_companies: set[str],
) -> float:
    company_novelty_bonus = (
        COMPANY_NOVELTY_BONUS
        if normalize_text(candidate.current_company) not in seen_companies
        else 0.0
    )
    role_fidelity = role_fidelity_score(candidate.current_title, original_seed_role)
    completeness = completeness_score(candidate)

    years = candidate.years_at_current_role or 0.0
    years_bonus = min(years, 5) * 0.1

    hit_count = getattr(candidate, "query_hit_count", 1) or 1
    query_frequency_penalty = hit_count * QUERY_FREQUENCY_PENALTY_WEIGHT

    return (
        company_novelty_bonus
        + role_fidelity
        + completeness
        + years_bonus
        - query_frequency_penalty
    )


def select_pivot(
    similar_company_matches: list[PersonaLeadRecord],
    original_seed_role: str | None,
    seen_companies: set[str],
) -> PersonaLeadRecord | None:
    scored = [
        (score_pivot_candidate(record, original_seed_role, seen_companies), record)
        for record in similar_company_matches
        if record.linkedin_url  # must have a URL to anchor the next search
    ]
    if not scored:
        return None
    return max(scored, key=lambda item: item[0])[1]


def lead_record_to_seed(
    record: PersonaLeadRecord,
    *,
    target_industry: str | None = None,
    target_location: str | None = None,
) -> SeedPersona:
    if not record.full_name:
        raise ValueError("Cannot pivot: candidate has no full_name")
    if not record.current_title:
        raise ValueError("Cannot pivot: candidate has no current_title")
    if not record.current_company:
        raise ValueError("Cannot pivot: candidate has no current_company")

    return SeedPersona(
        person_name=record.full_name,
        role=record.current_title,
        company_name=record.current_company,
        linkedin_url=record.linkedin_url,
        target_industry=target_industry,
        target_location=target_location,
    )
