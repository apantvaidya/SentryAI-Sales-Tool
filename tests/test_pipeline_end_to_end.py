"""Phase 1 fixture-driven end-to-end pipeline test.

Wires distill → chunk-and-rank → extract (FakeLLM) → confidence and asserts
the result conforms to the public `ProfileResult` schema. This is the exit
gate for Phase 1 in `docs/PLAN.md`.
"""

from __future__ import annotations

from sentry_scraper_module.agents.chunker import select_relevant_chunks
from sentry_scraper_module.agents.confidence import compute_confidence
from sentry_scraper_module.agents.distiller import distill
from sentry_scraper_module.agents.extractor import extract_profile
from sentry_scraper_module.agents.types import DistilledPage
from sentry_scraper_module.api.schemas import (
    BuildMetadata,
    ContactSection,
    OutreachStrategy,
    PersonalSection,
    ProfessionalSection,
    Profile,
    ProfileRequest,
    ProfileResult,
)
from sentry_scraper_module.providers.embeddings import HashEmbeddings
from sentry_scraper_module.providers.llm import FakeLLM

_FIXTURE_URLS = {
    "linkedin_profile": "https://www.linkedin.com/in/jane-smith",
    "company_about": "https://acme.example/about",
    "news_article": "https://techcrunch.com/2024/acme-restructure",
    "empty_challenge": "https://example.com/challenge",
}


async def test_phase_1_pipeline_produces_valid_profile_result(
    fixture_html: dict[str, str],
    hash_embeddings: HashEmbeddings,
) -> None:
    # 1. Distill every fixture.
    distilled: list[DistilledPage] = []
    for stem, html in fixture_html.items():
        page = distill(html, url=_FIXTURE_URLS[stem])
        if page is not None:
            distilled.append(page)

    # The challenge page must drop out; the three real pages survive.
    assert len(distilled) >= 3
    assert all("challenge" not in page.url for page in distilled)

    # 2. Chunk + rank against a target-shaped query.
    request = ProfileRequest(target_name="Jane Smith", company_name="Acme Corp")
    query = f"{request.target_name} {request.company_name or ''} VP Engineering responsibilities"
    chunks = select_relevant_chunks(distilled, query, embeddings=hash_embeddings)
    assert chunks, "expected at least one chunk to survive selection"

    # 3. Extract via canned LLM response.
    canned = Profile(
        personal=PersonalSection(name="Jane Smith", exact_location="San Francisco Bay Area"),
        professional=ProfessionalSection(
            title="VP of Engineering",
            company="Acme Corp",
            responsibilities=[
                "Owns the platform roadmap",
                "Oversees infrastructure, observability, and developer tooling",
            ],
            reports_to="CTO Robert Lee",
            oversees=["120 engineers across infra, data, and developer experience"],
            cost_metrics="~$42M annual engineering budget",
        ),
        contact=ContactSection(
            social_links=["https://www.linkedin.com/in/jane-smith"],
        ),
        outreach_strategy=OutreachStrategy(
            pain_points=["Cross-team handoff costs slowing shipping"],
            how_we_benefit_them="Cut handoff costs in the consolidated platform pillar",
        ),
    )
    fake_llm = FakeLLM(canned)
    profile = await extract_profile(request, chunks, llm=fake_llm)
    assert profile is canned

    # 4. Confidence scoring.
    sources = [page.url for page in distilled]
    score, low = compute_confidence(profile, sources)
    assert 0.0 <= score <= 1.0

    # 5. Final `ProfileResult` round-trips through JSON.
    result = ProfileResult(
        profile=profile,
        metadata=BuildMetadata(
            sources_used=sources,
            confidence_score=score,
            low_confidence=low,
        ),
    )
    payload = result.model_dump_json()
    restored = ProfileResult.model_validate_json(payload)
    assert restored == result
    assert "Jane Smith" in payload
    assert "Acme Corp" in payload
