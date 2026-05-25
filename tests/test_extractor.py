"""Tests for the extraction stage."""

from __future__ import annotations

from sentry_scraper_module.agents.extractor import (
    SYSTEM_PROMPT,
    extract_profile,
    render_user_prompt,
)
from sentry_scraper_module.agents.types import Chunk
from sentry_scraper_module.api.schemas import (
    PersonalSection,
    ProfessionalSection,
    Profile,
    ProfileRequest,
)
from sentry_scraper_module.providers.llm import FakeLLM


def test_render_user_prompt_includes_target_company_and_chunks() -> None:
    request = ProfileRequest(target_name="Jane Smith", company_name="Acme Corp")
    chunks = [
        Chunk(page_url="https://linkedin.com/in/jane", text="LI excerpt", similarity=0.9),
        Chunk(page_url="https://acme.example/about", text="About excerpt", similarity=0.7),
    ]
    prompt = render_user_prompt(request, chunks)
    assert "Jane Smith" in prompt
    assert "Acme Corp" in prompt
    assert "LI excerpt" in prompt
    assert "About excerpt" in prompt
    assert "https://linkedin.com/in/jane" in prompt


def test_render_user_prompt_includes_context_goal_when_provided() -> None:
    request = ProfileRequest(
        target_name="Jane Smith",
        context_goal="developer tooling pitch",
    )
    prompt = render_user_prompt(request, [])
    assert "developer tooling pitch" in prompt


def test_render_user_prompt_handles_empty_chunks() -> None:
    request = ProfileRequest(target_name="Jane Smith")
    prompt = render_user_prompt(request, [])
    assert "No source excerpts" in prompt


def test_system_prompt_enforces_b2b_and_grounding() -> None:
    # Compliance/grounding guarantees we want the prompt to keep stating.
    assert "B2B" in SYSTEM_PROMPT
    assert "speculate" in SYSTEM_PROMPT.lower()
    assert "cost_metrics" in SYSTEM_PROMPT
    assert "how_we_benefit_them" in SYSTEM_PROMPT


async def test_extract_profile_invokes_llm_with_expected_payload() -> None:
    canned = Profile(
        personal=PersonalSection(name="Jane Smith"),
        professional=ProfessionalSection(title="VP of Engineering", company="Acme Corp"),
    )
    fake = FakeLLM(canned)
    request = ProfileRequest(target_name="Jane Smith", company_name="Acme Corp")
    chunks = [Chunk(page_url="u1", text="Jane runs Acme eng", similarity=0.8)]

    result = await extract_profile(request, chunks, llm=fake)

    assert result is canned
    assert len(fake.calls) == 1
    call = fake.calls[0]
    assert call.system == SYSTEM_PROMPT
    assert "Jane Smith" in call.user
    assert "Acme Corp" in call.user
    assert call.schema == "Profile"
