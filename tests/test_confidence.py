"""Tests for the confidence scoring helper."""

from __future__ import annotations

import pytest

from sentry_scraper_module.agents.confidence import (
    BLOG_AUTHORITY,
    DEFAULT_AUTHORITY,
    HIGH_AUTHORITY,
    NEWS_AUTHORITY,
    compute_confidence,
    score_authority,
)
from sentry_scraper_module.api.schemas import (
    ContactSection,
    OutreachStrategy,
    PersonalSection,
    ProfessionalSection,
    Profile,
)


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://linkedin.com/in/jane", HIGH_AUTHORITY["linkedin.com"]),
        ("https://www.linkedin.com/in/jane", HIGH_AUTHORITY["linkedin.com"]),
        ("https://github.com/jane", HIGH_AUTHORITY["github.com"]),
        ("https://en.wikipedia.org/wiki/Jane", HIGH_AUTHORITY["wikipedia.org"]),
        ("https://www.nytimes.com/article", NEWS_AUTHORITY),
        ("https://techcrunch.com/post", NEWS_AUTHORITY),
        ("https://janes-blog.example/post", BLOG_AUTHORITY),
        ("https://medium.com/@jane/post", BLOG_AUTHORITY),
        ("https://random-co.example", DEFAULT_AUTHORITY),
    ],
)
def test_score_authority_known_tiers(url: str, expected: float) -> None:
    assert score_authority(url) == expected


def test_score_authority_handles_missing_scheme() -> None:
    assert score_authority("linkedin.com/in/jane") == HIGH_AUTHORITY["linkedin.com"]


def test_compute_confidence_empty_profile_no_sources() -> None:
    score, low = compute_confidence(Profile(), [])
    assert score == 0.0
    assert low is True


def test_compute_confidence_empty_profile_high_authority_source() -> None:
    score, low = compute_confidence(Profile(), ["https://linkedin.com/in/jane"])
    # Presence ratio is 0; only authority contributes 0.4 * 1.0 = 0.4.
    assert score == pytest.approx(0.4, abs=0.01)
    assert low is False  # 0.4 == low_threshold; flag fires only below it.


def test_compute_confidence_full_profile_high_authority() -> None:
    profile = Profile(
        personal=PersonalSection(name="Jane", exact_location="SF", interests=["jazz"]),
        professional=ProfessionalSection(
            title="VP",
            company="Acme",
            responsibilities=["platform"],
            reports_to="CTO",
            oversees=["infra"],
            cost_metrics="$42M budget",
        ),
        contact=ContactSection(
            best_channels=["email"],
            emails=["jane@acme.example"],
            social_links=["https://linkedin.com/in/jane"],
        ),
        outreach_strategy=OutreachStrategy(
            pain_points=["latency"],
            how_we_benefit_them="reduce migration risk",
        ),
    )
    score, low = compute_confidence(profile, ["https://linkedin.com/in/jane"])
    assert score >= 0.9
    assert low is False


def test_compute_confidence_clamps_to_unit_interval() -> None:
    profile = Profile(personal=PersonalSection(name="x"))
    score, _ = compute_confidence(profile, ["https://example.com"])
    assert 0.0 <= score <= 1.0


def test_compute_confidence_low_flag_below_threshold() -> None:
    score, low = compute_confidence(
        Profile(personal=PersonalSection(name="only-one-field")),
        [],
    )
    # presence ~ 1/14 ≈ 0.07, authority 0 → score ~ 0.04 → low
    assert low is True
    assert score < 0.4
