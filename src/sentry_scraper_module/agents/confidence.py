"""Confidence scoring for a finished profile.

Phase 1 ships a deliberately simple presence + authority blend. Phase 2's
LangGraph wiring adds per-field source attribution and the LLM
self-report term described in `docs/DESIGN.md §8`.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any
from urllib.parse import urlparse

from sentry_scraper_module.api.schemas import Profile

# Tier weights are intentionally coarse. They give us a stable, explainable
# score; finer-grained authority modelling can come from real-world traffic
# data later.
HIGH_AUTHORITY: dict[str, float] = {
    "linkedin.com": 1.0,
    "github.com": 0.9,
    "wikipedia.org": 0.85,
    "crunchbase.com": 0.85,
}
NEWS_AUTHORITY = 0.8
BLOG_AUTHORITY = 0.5
DEFAULT_AUTHORITY = 0.6
LOW_CONFIDENCE_THRESHOLD = 0.4

_NEWS_DOMAINS = frozenset(
    {
        "bloomberg.com",
        "ft.com",
        "nytimes.com",
        "reuters.com",
        "techcrunch.com",
        "theverge.com",
        "wired.com",
        "wsj.com",
    }
)
_BLOG_HINTS = ("blog", "medium.com", "substack.com", "wordpress.com")


def score_authority(url: str) -> float:
    """Map a URL's host to a coarse authority weight."""
    host = _normalised_host(url)
    if not host:
        return DEFAULT_AUTHORITY
    for known, weight in HIGH_AUTHORITY.items():
        if host == known or host.endswith("." + known):
            return weight
    if any(host == d or host.endswith("." + d) for d in _NEWS_DOMAINS):
        return NEWS_AUTHORITY
    if any(hint in host for hint in _BLOG_HINTS):
        return BLOG_AUTHORITY
    return DEFAULT_AUTHORITY


def compute_confidence(
    profile: Profile,
    sources: Sequence[str],
    *,
    low_threshold: float = LOW_CONFIDENCE_THRESHOLD,
) -> tuple[float, bool]:
    """Return `(confidence_score, low_confidence_flag)`.

    The score is a weighted average of two terms:

    - *Presence ratio* (weight 0.6): fraction of leaf fields that are
      non-empty. Captures how complete the profile is.
    - *Mean source authority* (weight 0.4): average of `score_authority` for
      each source URL. Captures how trustworthy the inputs were.

    The flag is true iff the score is below `low_threshold`.
    """
    presence = _presence_ratio(profile)
    authority = sum(score_authority(s) for s in sources) / len(sources) if sources else 0.0
    score = round(0.6 * presence + 0.4 * authority, 2)
    score = max(0.0, min(score, 1.0))
    return score, score < low_threshold


def _presence_ratio(profile: Profile) -> float:
    leaves: list[Any] = [
        profile.personal.name,
        profile.personal.exact_location,
        profile.personal.interests,
        profile.professional.title,
        profile.professional.company,
        profile.professional.responsibilities,
        profile.professional.reports_to,
        profile.professional.oversees,
        profile.professional.cost_metrics,
        profile.contact.best_channels,
        profile.contact.emails,
        profile.contact.social_links,
        profile.outreach_strategy.pain_points,
        profile.outreach_strategy.how_we_benefit_them,
    ]
    filled = sum(1 for leaf in leaves if _is_filled(leaf))
    return filled / len(leaves)


def _is_filled(leaf: Any) -> bool:
    if isinstance(leaf, str):
        return bool(leaf.strip())
    if isinstance(leaf, list):
        return len(leaf) > 0
    return leaf is not None


def _normalised_host(url: str) -> str:
    parsed = urlparse(url if "://" in url else f"https://{url}")
    host = (parsed.hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    return host


__all__ = [
    "BLOG_AUTHORITY",
    "DEFAULT_AUTHORITY",
    "HIGH_AUTHORITY",
    "LOW_CONFIDENCE_THRESHOLD",
    "NEWS_AUTHORITY",
    "compute_confidence",
    "score_authority",
]
