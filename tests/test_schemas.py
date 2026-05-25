"""Schema contract tests for the public API I/O models."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from sentry_scraper_module.api.schemas import (
    BuildMetadata,
    PersonalSection,
    Profile,
    ProfileRequest,
    ProfileResult,
)


def test_profile_request_requires_target_name() -> None:
    with pytest.raises(ValidationError):
        ProfileRequest()  # type: ignore[call-arg]


def test_profile_request_rejects_empty_target_name() -> None:
    with pytest.raises(ValidationError):
        ProfileRequest(target_name="")


def test_profile_request_minimal_payload() -> None:
    request = ProfileRequest(target_name="Jane Smith")
    assert request.target_name == "Jane Smith"
    assert request.company_name is None
    assert request.seed_urls == []
    assert request.context_goal is None


def test_profile_request_full_payload() -> None:
    request = ProfileRequest(
        target_name="Jane Smith",
        company_name="Acme Corp",
        seed_urls=["https://linkedin.com/in/jane-smith"],  # type: ignore[list-item]
        context_goal="developer tooling pitch",
    )
    assert request.company_name == "Acme Corp"
    assert len(request.seed_urls) == 1
    assert request.context_goal == "developer tooling pitch"


def test_profile_request_forbids_extra_fields() -> None:
    with pytest.raises(ValidationError):
        ProfileRequest(target_name="Jane", surprise="boom")  # type: ignore[call-arg]


def test_profile_defaults_to_empty_sections() -> None:
    profile = Profile()
    assert profile.personal.name == ""
    assert profile.personal.exact_location == ""
    assert profile.personal.interests == []
    assert profile.professional.responsibilities == []
    assert profile.professional.cost_metrics == ""
    assert profile.contact.emails == []
    assert profile.outreach_strategy.how_we_benefit_them == ""


def test_profile_round_trip() -> None:
    original = Profile(personal=PersonalSection(name="Jane", interests=["jazz"]))
    restored = Profile.model_validate(original.model_dump())
    assert restored == original


def test_profile_forbids_extra_fields() -> None:
    with pytest.raises(ValidationError):
        Profile(personal=PersonalSection(name="x", surprise=1))  # type: ignore[call-arg]


def test_profile_result_round_trip_via_json() -> None:
    result = ProfileResult(
        profile=Profile(),
        metadata=BuildMetadata(
            sources_used=["https://example.com/a"],
            confidence_score=0.42,
            low_confidence=True,
        ),
    )
    payload = result.model_dump_json()
    restored = ProfileResult.model_validate_json(payload)
    assert restored == result
