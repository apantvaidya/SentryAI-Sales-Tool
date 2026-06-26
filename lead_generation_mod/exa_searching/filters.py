from __future__ import annotations

from .dedupe import is_same_company_name, normalize_text
from .models import FilterDecision, MappedCandidate, SeedPersona


BLACKLIST_TERMS = (
    "recruiter",
    "talent acquisition",
    "consultant",
    "advisor",
    "sales",
    "account manager",
    "account executive",
    "vendor",
    "business development",
    "sdr",
    "bdr",
    "journalist",
    "student",
)

FOUNDER_CLASS_TERMS = ("founder", "ceo", "owner")

PRIMARY_ROLE_TERMS = (
    "asset protection",
    "loss prevention",
    "security",
    "shrink",
)

ADJACENT_ROLE_TERMS = (
    "operations",
    "facilities",
    "district",
    "regional",
    "store",
)


def is_founder_class(title: str) -> bool:
    return any(term in title for term in FOUNDER_CLASS_TERMS)


def is_borderline_title(title: str) -> bool:
    return any(term in title for term in ADJACENT_ROLE_TERMS) and not any(
        term in title for term in PRIMARY_ROLE_TERMS
    )


def matches_seed_company_scope(candidate_company: str, seed_company: str) -> bool:
    if is_same_company_name(candidate_company, seed_company):
        return True
    candidate_norm = normalize_text(candidate_company)
    seed_norm = normalize_text(seed_company)
    if not candidate_norm or not seed_norm:
        return False
    return seed_norm in candidate_norm or candidate_norm in seed_norm


def filter_candidate(candidate: MappedCandidate, seed_persona: SeedPersona) -> FilterDecision:
    reasons: list[str] = []

    if not candidate.full_name:
        reasons.append("missing_full_name")
    if not candidate.current_title:
        reasons.append("missing_current_title")
    if not candidate.current_company:
        reasons.append("missing_current_company")
    if not candidate.linkedin_url:
        reasons.append("missing_linkedin_url")

    if reasons:
        return FilterDecision(status="dropped", reasons=reasons, candidate=candidate)

    title_lc = candidate.current_title.lower()
    seed_title_lc = (seed_persona.role or "").lower()

    if any(term in title_lc for term in BLACKLIST_TERMS):
        return FilterDecision(
            status="dropped",
            reasons=["blacklisted_title"],
            candidate=candidate,
        )

    if is_founder_class(title_lc) and not is_founder_class(seed_title_lc):
        return FilterDecision(
            status="dropped",
            reasons=["founder_class_mismatch"],
            candidate=candidate,
        )

    if candidate.source_bucket == "same_company" and not matches_seed_company_scope(
        candidate.current_company, seed_persona.company_name
    ):
        return FilterDecision(
            status="dropped",
            reasons=["same_company_mismatch"],
            candidate=candidate,
        )

    auto_approved_reasons: list[str] = []
    if candidate.current_role_count > 1:
        auto_approved_reasons.append("multiple_current_roles")
    if candidate.used_recent_role_fallback:
        auto_approved_reasons.append("used_recent_role_fallback")
    if is_borderline_title(title_lc):
        auto_approved_reasons.append("borderline_title")

    return FilterDecision(status="accepted", reasons=auto_approved_reasons, candidate=candidate)
