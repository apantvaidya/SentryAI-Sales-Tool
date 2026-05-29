"""Tests for `agents.planner`."""

from __future__ import annotations

from pydantic import HttpUrl

from sentry_scraper_module.agents.planner import (
    build_queries,
    build_retrieval_queries,
    merge_and_rank,
    plan_candidates,
    resolve_plan_budget,
)
from sentry_scraper_module.api.schemas import ProfileRequest
from sentry_scraper_module.core.config import Settings
from sentry_scraper_module.providers.serp import FakeSerp, SerpResult

# ---------------------------------------------------------------------------
# build_queries
# ---------------------------------------------------------------------------


def test_build_queries_includes_linkedin_and_company_variants() -> None:
    request = ProfileRequest(target_name="Jane Smith", company_name="Acme Corp")
    queries = build_queries(request)
    assert any("site:linkedin.com" in q for q in queries)
    assert any("Acme Corp" in q for q in queries)
    assert any("responsibilities" in q for q in queries)
    assert all("Jane Smith" in q for q in queries)


def test_build_queries_skips_company_variants_without_company() -> None:
    request = ProfileRequest(target_name="Jane Smith")
    queries = build_queries(request)
    assert any("site:linkedin.com" in q for q in queries)
    assert not any("responsibilities" in q for q in queries)
    # Always at least linkedin + the bare-name fallback.
    assert len(queries) >= 2


def test_build_queries_deep_mode_adds_pain_point_and_blog_queries() -> None:
    surface = ProfileRequest(target_name="Jane Smith", company_name="Acme Corp")
    deep = ProfileRequest(target_name="Jane Smith", company_name="Acme Corp", mode="deep")
    surface_queries = build_queries(surface)
    deep_queries = build_queries(deep)
    # Deep mode is a strict superset that adds pain-point + blog refiners.
    assert set(surface_queries).issubset(set(deep_queries))
    assert any("blog" in q for q in deep_queries)
    assert any("challenges" in q or "problems" in q for q in deep_queries)
    assert len(deep_queries) > len(surface_queries)
    # No accidental duplicates.
    assert len(deep_queries) == len(set(deep_queries))


def test_build_queries_deep_mode_folds_in_context_goal() -> None:
    deep = ProfileRequest(
        target_name="Jane Smith",
        company_name="Acme Corp",
        context_goal="reduce cloud spend",
        mode="deep",
    )
    queries = build_queries(deep)
    assert any("reduce cloud spend" in q for q in queries)


def test_resolve_plan_budget_maps_mode_to_settings() -> None:
    settings = Settings(
        surface_max_candidates=3,
        surface_results_per_query=4,
        deep_max_candidates=15,
        deep_results_per_query=10,
    )
    surface = resolve_plan_budget("surface", settings)
    deep = resolve_plan_budget("deep", settings)
    assert (surface.max_candidates, surface.results_per_query) == (3, 4)
    assert (deep.max_candidates, deep.results_per_query) == (15, 10)


def test_build_retrieval_queries_prioritizes_role_and_company_pains() -> None:
    request = ProfileRequest(
        target_name="Jane Smith",
        company_name="Acme Corp",
        context_goal="reduce incident-response toil",
    )
    queries = build_retrieval_queries(request)
    assert queries
    assert any("responsibilities priorities initiatives roadmap" in q for q in queries)
    assert any("challenges pain points priorities bottlenecks initiatives" in q for q in queries)
    assert any("reduce incident-response toil" in q for q in queries)


def test_build_retrieval_queries_deep_mode_adds_interview_and_strategy_passes() -> None:
    request = ProfileRequest(
        target_name="Jane Smith",
        company_name="Acme Corp",
        mode="deep",
    )
    queries = build_retrieval_queries(request)
    assert any("interview blog strategy" in q for q in queries)
    assert any("efficiency risks hiring roadmap" in q for q in queries)


# ---------------------------------------------------------------------------
# merge_and_rank
# ---------------------------------------------------------------------------


def test_merge_and_rank_dedupes_seed_and_serp() -> None:
    candidates = merge_and_rank(
        seed_urls=["https://linkedin.com/in/jane"],
        serp_hits=[
            (
                "q",
                SerpResult(url="https://linkedin.com/in/jane/", position=1),
            ),
            ("q", SerpResult(url="https://news.example/jane", position=2)),
        ],
    )
    urls = [c.url for c in candidates]
    # Seed wins the dedupe tie even though the SERP result has the same URL.
    assert urls.count("https://linkedin.com/in/jane") == 1
    assert "https://news.example/jane" in urls


def test_merge_and_rank_orders_by_authority_then_position() -> None:
    candidates = merge_and_rank(
        seed_urls=[],
        serp_hits=[
            ("q", SerpResult(url="https://medium.com/blog", position=1)),
            ("q", SerpResult(url="https://linkedin.com/in/jane", position=5)),
        ],
        max_candidates=10,
    )
    # LinkedIn should outrank a generic blog despite worse SERP position
    # because authority_tier is the primary key.
    assert candidates[0].url.startswith("https://linkedin.com")


def test_merge_and_rank_respects_max_candidates() -> None:
    serp_hits = [("q", SerpResult(url=f"https://x.example/{i}", position=i)) for i in range(1, 11)]
    candidates = merge_and_rank(seed_urls=[], serp_hits=serp_hits, max_candidates=3)
    assert len(candidates) == 3


def test_merge_and_rank_marks_sources_correctly() -> None:
    candidates = merge_and_rank(
        seed_urls=["https://seed.example/a"],
        serp_hits=[("q", SerpResult(url="https://serp.example/b", position=1))],
    )
    by_url = {c.url: c for c in candidates}
    assert by_url["https://seed.example/a"].source == "seed"
    assert by_url["https://serp.example/b"].source == "serp"
    assert by_url["https://serp.example/b"].query == "q"


# ---------------------------------------------------------------------------
# plan_candidates (integration with FakeSerp)
# ---------------------------------------------------------------------------


async def test_plan_candidates_runs_every_query_and_merges() -> None:
    request = ProfileRequest(
        target_name="Jane Smith",
        company_name="Acme Corp",
        seed_urls=[HttpUrl("https://github.com/janesmith")],
    )
    queries = build_queries(request)
    serp = FakeSerp(
        {
            queries[0]: [
                SerpResult(url="https://linkedin.com/in/jane", position=1),
            ],
            queries[1]: [
                SerpResult(url="https://acme.example/team", position=1),
            ],
        }
    )
    plan, candidates = await plan_candidates(request, serp=serp)
    urls = [c.url for c in candidates]

    assert plan == queries
    assert "https://github.com/janesmith" in urls  # seed survived
    assert "https://linkedin.com/in/jane" in urls
    assert "https://acme.example/team" in urls
    assert serp.calls == queries
