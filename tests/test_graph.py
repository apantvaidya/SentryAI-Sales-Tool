"""End-to-end tests for the LangGraph profile pipeline.

Network is mocked with `httpx.MockTransport` and SERP / LLM are replaced
by their `Fake*` counterparts, so the full graph runs locally with no
external dependencies.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import httpx
import pytest

from sentry_scraper_module.agents.graph import (
    NODE_NAMES,
    PipelineDeps,
    run_profile_pipeline,
)
from sentry_scraper_module.agents.state import initial_state
from sentry_scraper_module.api.schemas import (
    PersonalSection,
    ProfessionalSection,
    Profile,
    ProfileRequest,
)
from sentry_scraper_module.providers.embeddings import HashEmbeddings
from sentry_scraper_module.providers.llm import FakeLLM
from sentry_scraper_module.providers.serp import FakeSerp, SerpResult

FIXTURES_DIR = Path(__file__).parent / "fixtures"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _serve_fixtures(
    mapping: dict[str, str],
    *,
    challenge_urls: set[str] | None = None,
) -> Callable[[httpx.Request], httpx.Response]:
    """Return an httpx handler that serves canned HTML per URL.

    URLs in `challenge_urls` are served as a Cloudflare-style block on
    the *first* attempt and as the canned body on subsequent attempts.
    We discriminate by attempt count rather than User-Agent because the
    Phase 3 stub browser uses the same fingerprinted headers as the
    static fetcher.
    """
    challenges = challenge_urls or set()
    attempts: dict[str, int] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        attempts[url] = attempts.get(url, 0) + 1
        if url in challenges and attempts[url] == 1:
            return httpx.Response(
                503,
                html=("<html><body>Just a moment...<!-- cf-mitigated --></body></html>"),
            )
        body = mapping.get(url)
        if body is None:
            return httpx.Response(404, content=b"missing")
        return httpx.Response(200, html=body)

    return handler


def _canned_profile() -> Profile:
    return Profile(
        personal=PersonalSection(name="Jane Smith"),
        professional=ProfessionalSection(title="VP of Engineering", company="Acme Corp"),
    )


def _serp_for(queries: list[str], urls: list[str]) -> FakeSerp:
    """Map every planner query to the same set of canned URLs."""
    results = [SerpResult(url=url, title=url, position=i + 1) for i, url in enumerate(urls)]
    return FakeSerp({q: results for q in queries})


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.fixture
def fixture_bodies() -> dict[str, str]:
    return {
        "https://linkedin.com/in/jane-smith": (FIXTURES_DIR / "linkedin_profile.html").read_text(),
        "https://acme.example/about": (FIXTURES_DIR / "company_about.html").read_text(),
    }


async def test_pipeline_happy_path_runs_every_node(
    fixture_bodies: dict[str, str],
) -> None:
    request = ProfileRequest(target_name="Jane Smith", company_name="Acme Corp")
    from sentry_scraper_module.agents.planner import build_queries

    serp = _serp_for(build_queries(request), list(fixture_bodies))

    transport = httpx.MockTransport(_serve_fixtures(fixture_bodies))
    stages: list[str] = []

    async def stage_callback(name: str) -> None:
        stages.append(name)

    async with httpx.AsyncClient(transport=transport) as client:
        deps = PipelineDeps(
            http_client=client,
            serp=serp,
            llm=FakeLLM(_canned_profile()),
            embeddings=HashEmbeddings(dim=64),
            stage_callback=stage_callback,
        )
        final = await run_profile_pipeline(initial_state(request), deps=deps)

    # Every non-conditional node ran in order; headless was skipped because
    # the static fetcher saw clean responses.
    assert "fetch_headless" not in stages
    expected = [n for n in NODE_NAMES if n != "fetch_headless"]
    assert stages == expected

    # Profile populated, metadata computed, sources include both fixtures.
    assert final["profile"] is not None
    assert final["profile"].personal.name == "Jane Smith"
    assert final["metadata"] is not None
    assert set(final["metadata"].sources_used) == set(fixture_bodies)
    assert 0.0 < final["metadata"].confidence_score <= 1.0


async def test_pipeline_escalates_when_static_fetch_is_blocked(
    fixture_bodies: dict[str, str],
) -> None:
    request = ProfileRequest(target_name="Jane Smith", company_name="Acme Corp")
    from sentry_scraper_module.agents.planner import build_queries

    blocked = "https://linkedin.com/in/jane-smith"
    serp = _serp_for(build_queries(request), list(fixture_bodies))

    transport = httpx.MockTransport(_serve_fixtures(fixture_bodies, challenge_urls={blocked}))
    stages: list[str] = []

    async def stage_callback(name: str) -> None:
        stages.append(name)

    async with httpx.AsyncClient(transport=transport) as client:
        deps = PipelineDeps(
            http_client=client,
            serp=serp,
            llm=FakeLLM(_canned_profile()),
            embeddings=HashEmbeddings(dim=64),
            stage_callback=stage_callback,
        )
        final = await run_profile_pipeline(initial_state(request), deps=deps)

    # Escalation was triggered and the headless fetch ran.
    assert "fetch_headless" in stages
    assert final["needs_escalation"] is True

    # The final fetched list contains both the blocked static attempt and
    # the successful headless retry for the same URL.
    fetched_urls = [(p.url, p.fetched_via) for p in final["fetched"]]
    assert (blocked, "static") in fetched_urls
    assert (blocked, "headless") in fetched_urls

    # Distill prefers the headless body, so the profile still came through.
    assert final["profile"] is not None
    assert final["metadata"] is not None
    assert blocked in final["metadata"].sources_used


async def test_pipeline_with_no_candidates_returns_empty_metadata() -> None:
    request = ProfileRequest(target_name="Nobody")
    from sentry_scraper_module.agents.planner import build_queries

    serp = FakeSerp({q: [] for q in build_queries(request)})

    def handler(_: httpx.Request) -> httpx.Response:
        raise AssertionError("fetcher should not run when there are no candidates")

    transport = httpx.MockTransport(handler)

    async with httpx.AsyncClient(transport=transport) as client:
        deps = PipelineDeps(
            http_client=client,
            serp=serp,
            llm=FakeLLM(_canned_profile()),
            embeddings=HashEmbeddings(dim=64),
        )
        final = await run_profile_pipeline(initial_state(request), deps=deps)

    assert final["candidates"] == []
    assert final["fetched"] == []
    assert final["distilled"] == []
    # Extractor still produced the canned profile, but no sources are
    # attributable so confidence is zero / low_confidence is True.
    assert final["metadata"] is not None
    assert final["metadata"].sources_used == []
    assert final["metadata"].low_confidence is True
