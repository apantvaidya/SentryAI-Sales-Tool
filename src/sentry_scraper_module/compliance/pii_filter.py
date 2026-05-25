"""Category-based PII redactor.

Per `docs/DESIGN.md §7.2`, the extractor is also instructed to stay B2B
via the system prompt — this filter is the second leg of defense. We
scan every string field of the extracted `Profile` against a labelled
set of patterns and either redact (replace with `[redacted:<category>]`)
or drop the value entirely (for list items).

The function returns the cleaned profile *and* a list of `Redaction`
records so the caller can emit one audit entry per redaction.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Final

from sentry_scraper_module.api.schemas import (
    ContactSection,
    OutreachStrategy,
    PersonalSection,
    ProfessionalSection,
    Profile,
)

# Each category is a list of case-insensitive regex patterns. Keep them
# tight: false positives on legitimate B2B content are worse than letting
# a rare phrase through (the LLM system prompt is the first leg).
_CATEGORY_PATTERNS: Final[dict[str, tuple[re.Pattern[str], ...]]] = {
    "health": tuple(
        re.compile(p, re.IGNORECASE)
        for p in (
            r"\b(diagnosed|diagnosis|treatment|surgery|cancer|diabetes|HIV|"
            r"depression|anxiety|disability|disabled|chronic illness|medication)\b",
        )
    ),
    "family": tuple(
        re.compile(p, re.IGNORECASE)
        for p in (
            r"\b(spouse|husband|wife|partner|daughter|son|child(?:ren)?|"
            r"mother|father|sister|brother|divorced|married|single mom|single dad)\b",
        )
    ),
    "financial": tuple(
        re.compile(p, re.IGNORECASE)
        for p in (
            r"\b(salary|net worth|annual income|bank account|credit score|"
            r"mortgage|in debt|bankruptcy|investments?)\b",
            r"\$\s?\d[\d,]{3,}",  # $1,000+ dollar amounts framed as personal income
        )
    ),
    "religion_politics_sexuality": tuple(
        re.compile(p, re.IGNORECASE)
        for p in (
            r"\b(catholic|christian|muslim|jewish|hindu|buddhist|atheist|"
            r"republican|democrat|conservative|liberal|gay|lesbian|"
            r"transgender|bisexual)\b",
        )
    ),
    "government_id": tuple(
        re.compile(p, re.IGNORECASE)
        for p in (
            r"\bSSN[:\s]*\d{3}-?\d{2}-?\d{4}\b",
            r"\b\d{3}-\d{2}-\d{4}\b",  # raw SSN-shaped number
            r"\b(passport|driver'?s? license|national id)\s+(no\.?|number|#)?\s*[a-z0-9-]{5,}\b",
        )
    ),
}


@dataclass(frozen=True)
class Redaction:
    """One redaction event, suitable for an audit row."""

    field: str  # dotted path e.g. "personal.interests[2]" or "professional.cost_metrics"
    category: str
    matched_pattern: str  # the regex pattern that triggered the match


def _scan(value: str) -> tuple[str, list[Redaction]]:
    """Run all categories against `value`.

    Returns `(redacted_value, hits)`. The string is mutated by replacing
    each match with `[redacted:<category>]`; list items at the call site
    decide whether to drop the whole entry on any hit.
    """
    hits: list[Redaction] = []
    cleaned = value
    for category, patterns in _CATEGORY_PATTERNS.items():
        for pattern in patterns:
            if pattern.search(cleaned):
                hits.append(Redaction(field="", category=category, matched_pattern=pattern.pattern))
                cleaned = pattern.sub(f"[redacted:{category}]", cleaned)
    return cleaned, hits


def _scrub_scalar(value: str, field: str) -> tuple[str, list[Redaction]]:
    cleaned, hits = _scan(value)
    return cleaned, [
        Redaction(field=field, category=h.category, matched_pattern=h.matched_pattern) for h in hits
    ]


def _scrub_list(values: list[str], field: str) -> tuple[list[str], list[Redaction]]:
    """List items are dropped entirely on any match (they're short
    strings — once contaminated, redacted form is rarely meaningful)."""
    kept: list[str] = []
    redactions: list[Redaction] = []
    for i, item in enumerate(values):
        _, hits = _scan(item)
        if hits:
            redactions.extend(
                Redaction(
                    field=f"{field}[{i}]",
                    category=h.category,
                    matched_pattern=h.matched_pattern,
                )
                for h in hits
            )
            continue
        kept.append(item)
    return kept, redactions


def redact_pii(profile: Profile) -> tuple[Profile, list[Redaction]]:
    """Return a cleaned `Profile` plus the list of redactions applied.

    The original `profile` is not mutated; we build a new instance via
    `model_copy(update=...)` so callers can decide what to do with the
    untouched original (e.g. log it under audit before persisting only
    the cleaned form).
    """
    redactions: list[Redaction] = []

    # Personal section.
    name, hits = _scrub_scalar(profile.personal.name, "personal.name")
    redactions.extend(hits)
    location, hits = _scrub_scalar(profile.personal.exact_location, "personal.exact_location")
    redactions.extend(hits)
    interests, hits = _scrub_list(profile.personal.interests, "personal.interests")
    redactions.extend(hits)
    personal = PersonalSection(name=name, exact_location=location, interests=interests)

    # Professional section.
    title, hits = _scrub_scalar(profile.professional.title, "professional.title")
    redactions.extend(hits)
    company, hits = _scrub_scalar(profile.professional.company, "professional.company")
    redactions.extend(hits)
    responsibilities, hits = _scrub_list(
        profile.professional.responsibilities, "professional.responsibilities"
    )
    redactions.extend(hits)
    reports_to, hits = _scrub_scalar(profile.professional.reports_to, "professional.reports_to")
    redactions.extend(hits)
    oversees, hits = _scrub_list(profile.professional.oversees, "professional.oversees")
    redactions.extend(hits)
    cost_metrics, hits = _scrub_scalar(
        profile.professional.cost_metrics, "professional.cost_metrics"
    )
    redactions.extend(hits)
    professional = ProfessionalSection(
        title=title,
        company=company,
        responsibilities=responsibilities,
        reports_to=reports_to,
        oversees=oversees,
        cost_metrics=cost_metrics,
    )

    # Contact section.
    best_channels, hits = _scrub_list(profile.contact.best_channels, "contact.best_channels")
    redactions.extend(hits)
    emails, hits = _scrub_list(profile.contact.emails, "contact.emails")
    redactions.extend(hits)
    social_links, hits = _scrub_list(profile.contact.social_links, "contact.social_links")
    redactions.extend(hits)
    contact = ContactSection(
        best_channels=best_channels,
        emails=emails,
        social_links=social_links,
    )

    # Outreach strategy.
    pain_points, hits = _scrub_list(
        profile.outreach_strategy.pain_points, "outreach_strategy.pain_points"
    )
    redactions.extend(hits)
    benefit, hits = _scrub_scalar(
        profile.outreach_strategy.how_we_benefit_them,
        "outreach_strategy.how_we_benefit_them",
    )
    redactions.extend(hits)
    outreach = OutreachStrategy(pain_points=pain_points, how_we_benefit_them=benefit)

    cleaned = Profile(
        personal=personal,
        professional=professional,
        contact=contact,
        outreach_strategy=outreach,
    )
    return cleaned, redactions


__all__ = ["Redaction", "redact_pii"]
