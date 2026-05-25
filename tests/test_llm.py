"""Tests for the LLM provider helpers and `FakeLLM` test double."""

from __future__ import annotations

import pytest

from sentry_scraper_module.api.schemas import (
    BuildMetadata,
    PersonalSection,
    Profile,
)
from sentry_scraper_module.providers.llm import (
    FakeLLM,
    strict_json_schema,
)


def test_strict_json_schema_top_level_object() -> None:
    schema = strict_json_schema(Profile)
    assert schema["type"] == "object"
    assert schema["additionalProperties"] is False
    assert set(schema["required"]) == {
        "personal",
        "professional",
        "contact",
        "outreach_strategy",
    }


def test_strict_json_schema_recurses_into_defs() -> None:
    schema = strict_json_schema(Profile)
    defs = schema.get("$defs", {})
    assert defs, "expected sub-section definitions in $defs"
    for name, sub in defs.items():
        if sub.get("type") != "object":
            continue
        props = sub.get("properties", {})
        assert sub["additionalProperties"] is False, name
        assert sub.get("required", []) == list(props.keys()), name


def test_strict_json_schema_does_not_mutate_subsequent_calls() -> None:
    a = strict_json_schema(Profile)
    b = strict_json_schema(Profile)
    assert a == b


async def test_fake_llm_returns_canned_response() -> None:
    canned = Profile(personal=PersonalSection(name="Jane Smith"))
    fake = FakeLLM(canned)

    result = await fake.complete_json(system="sys", user="usr", schema=Profile)

    assert result is canned
    assert len(fake.calls) == 1
    call = fake.calls[0]
    assert call.system == "sys"
    assert call.user == "usr"
    assert call.schema == "Profile"
    assert call.model is None


async def test_fake_llm_records_model_override() -> None:
    fake = FakeLLM(Profile())
    await fake.complete_json(system="s", user="u", schema=Profile, model="x/y")
    assert fake.calls[0].model == "x/y"


async def test_fake_llm_rejects_schema_mismatch() -> None:
    fake = FakeLLM(Profile())
    with pytest.raises(TypeError, match=r"Profile.*BuildMetadata"):
        await fake.complete_json(system="s", user="u", schema=BuildMetadata)
