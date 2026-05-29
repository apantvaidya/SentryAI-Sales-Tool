"""Planner — turns a `ProfileRequest` into a ranked list of URLs to fetch.

Splits naturally into two pure helpers:
  - `build_queries`  — derives 2-4 SERP queries from the request.
  - `merge_and_rank` — combines SERP hits with seed URLs, deduplicates, and
                      sorts by `(authority_tier, -serp_position, source)`.

The async wrapper `plan_candidates` ties them together by calling a SERP
provider for every query.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from sentry_scraper_module.agents.confidence import score_authority
from sentry_scraper_module.agents.state import CandidateUrl
from sentry_scraper_module.api.schemas import ProfileRequest, ScrapeMode
from sentry_scraper_module.core.config import Settings
from sentry_scraper_module.providers.serp import SerpProvider, SerpResult

DEFAULT_MAX_CANDIDATES = 5
DEFAULT_RESULTS_PER_QUERY = 5


@dataclass(frozen=True)
class PlanBudget:
    """How aggressively the planner widens the candidate set for a mode.

    `max_candidates` caps the deduped/ranked URL set the fetchers consume;
    `results_per_query` caps SERP hits pulled per query before merging.
    """

    max_candidates: int = DEFAULT_MAX_CANDIDATES
    results_per_query: int = DEFAULT_RESULTS_PER_QUERY


def resolve_plan_budget(mode: ScrapeMode, settings: Settings) -> PlanBudget:
    """Map a scrape mode onto its configured fetch budget."""
    if mode == "deep":
        return PlanBudget(
            max_candidates=settings.deep_max_candidates,
            results_per_query=settings.deep_results_per_query,
        )
    return PlanBudget(
        max_candidates=settings.surface_max_candidates,
        results_per_query=settings.surface_results_per_query,
    )


def build_retrieval_queries(request: ProfileRequest) -> list[str]:
    """Return semantic retrieval queries for chunk ranking.

    SERP queries are tuned for search syntax (`site:`, explicit ORs, quoted
    phrases). Chunk ranking wants the opposite: a small set of natural-language
    intents that help us surface both identity/role evidence and the company or
    target signals most useful for `outreach_strategy`.

    This stays product-agnostic on purpose. The operator's pitch only enters via
    `context_goal`, which the caller controls per request.
    """
    name = request.target_name.strip()
    company = (request.company_name or "").strip()
    goal = (request.context_goal or "").strip()
    subject = company or name

    queries = [
        " ".join(
            part
            for part in [name, company, "responsibilities priorities initiatives roadmap"]
            if part
        )
    ]
    if company:
        queries.append(f"{company} challenges pain points priorities bottlenecks initiatives")
        queries.append(f"{name} {company} priorities initiatives transformation")
    else:
        queries.append(f"{name} challenges priorities initiatives")

    if goal:
        queries.append(f"{subject} {goal} problems priorities outcomes")

    if request.mode == "deep":
        if company:
            queries.append(f"{name} {company} interview blog strategy")
            queries.append(f"{company} efficiency risks hiring roadmap")
        else:
            queries.append(f"{name} interview blog strategy")

    seen: set[str] = set()
    deduped: list[str] = []
    for query in queries:
        cleaned = " ".join(query.split())
        if not cleaned or cleaned in seen:
            continue
        seen.add(cleaned)
        deduped.append(cleaned)
    return deduped


def build_queries(request: ProfileRequest) -> list[str]:
    """Return SERP queries covering the highest-yield angles for the mode.

    Surface mode always emits a `site:linkedin.com` query (single
    highest-authority hit) and a generic name+company query, plus a
    responsibilities refiner when a company is supplied.

    Deep mode adds pain-point / "problems we solve" and blog-archive
    queries so the extractor has material to ground `pain_points` and
    `how_we_benefit_them` rather than relying on opportunistic mentions.
    """
    name = request.target_name.strip()
    queries: list[str] = [f'"{name}" site:linkedin.com']
    company = (request.company_name or "").strip()
    if company:
        queries.append(f'"{name}" "{company}"')
        queries.append(f'"{name}" "{company}" responsibilities')
    else:
        queries.append(f'"{name}"')

    if request.mode == "deep":
        queries.extend(_deep_queries(name, company, request.context_goal))

    # Preserve order while removing accidental duplicates.
    seen: set[str] = set()
    deduped: list[str] = []
    for query in queries:
        if query in seen:
            continue
        seen.add(query)
        deduped.append(query)
    return deduped


def _deep_queries(name: str, company: str, context_goal: str | None) -> list[str]:
    """Pain-point + blog-archive refiners used only in deep mode."""
    queries: list[str] = []
    if company:
        queries.append(f'"{company}" challenges OR problems OR pain points')
        queries.append(f'"{company}" blog')
        queries.append(f'"{name}" "{company}" interview')
        queries.append(f'"{name}" "{company}" priorities OR initiatives')
    else:
        queries.append(f'"{name}" interview')
        queries.append(f'"{name}" challenges OR priorities')
    goal = (context_goal or "").strip()
    if goal:
        # Bias the SERP toward the operator's pitch so retrieved chunks
        # speak to "problems we solve".
        subject = company or name
        queries.append(f'"{subject}" {goal}')
    return queries


async def plan_candidates(
    request: ProfileRequest,
    *,
    serp: SerpProvider,
    max_candidates: int = DEFAULT_MAX_CANDIDATES,
    results_per_query: int = DEFAULT_RESULTS_PER_QUERY,
) -> tuple[list[str], list[CandidateUrl]]:
    """Run the SERP queries, merge with seeds, and return the ranked set.

    Returns `(queries, candidates)` so the graph can stash the queries on
    state for debugging. `candidates` is already truncated to
    `max_candidates`.
    """
    queries = build_queries(request)
    serp_hits: list[tuple[str, SerpResult]] = []
    for query in queries:
        results = await serp.search(query, num=results_per_query)
        serp_hits.extend((query, hit) for hit in results)

    candidates = merge_and_rank(
        seed_urls=[str(u) for u in request.seed_urls],
        serp_hits=serp_hits,
        max_candidates=max_candidates,
    )
    return queries, candidates


def merge_and_rank(
    *,
    seed_urls: Sequence[str],
    serp_hits: Iterable[tuple[str, SerpResult]],
    max_candidates: int = DEFAULT_MAX_CANDIDATES,
) -> list[CandidateUrl]:
    """Deduplicate by URL and sort by (authority desc, serp_position asc).

    Seed URLs always survive deduplication and inherit `source="seed"`.
    """
    seen: dict[str, CandidateUrl] = {}

    for url in seed_urls:
        normalised = _canonicalise(url)
        if normalised in seen:
            continue
        seen[normalised] = CandidateUrl(
            url=url,
            source="seed",
            authority_tier=score_authority(url),
        )

    for query, hit in serp_hits:
        normalised = _canonicalise(hit.url)
        if normalised in seen:
            continue
        seen[normalised] = CandidateUrl(
            url=hit.url,
            source="serp",
            serp_position=hit.position,
            authority_tier=score_authority(hit.url),
            query=query,
        )

    def sort_key(c: CandidateUrl) -> tuple[float, int, int]:
        # Negative authority for descending order; small positional tiebreaker;
        # seeds beat SERP hits at the same tier (source ordering).
        position = c.serp_position if c.serp_position is not None else 0
        source_rank = 0 if c.source == "seed" else 1
        return (-c.authority_tier, source_rank, position)

    ordered = sorted(seen.values(), key=sort_key)
    return ordered[:max_candidates]


def _canonicalise(url: str) -> str:
    """Cheap normalisation so `https://x.com/p` and `https://x.com/p/` dedupe."""
    return url.rstrip("/").lower()


__all__ = [
    "DEFAULT_MAX_CANDIDATES",
    "DEFAULT_RESULTS_PER_QUERY",
    "build_queries",
    "build_retrieval_queries",
    "merge_and_rank",
    "plan_candidates",
    "resolve_plan_budget",
]
