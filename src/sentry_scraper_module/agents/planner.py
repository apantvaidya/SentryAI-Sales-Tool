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

from sentry_scraper_module.agents.confidence import score_authority
from sentry_scraper_module.agents.state import CandidateUrl
from sentry_scraper_module.api.schemas import ProfileRequest
from sentry_scraper_module.providers.serp import SerpProvider, SerpResult

DEFAULT_MAX_CANDIDATES = 5
DEFAULT_RESULTS_PER_QUERY = 5


def build_queries(request: ProfileRequest) -> list[str]:
    """Return 2-4 SERP queries covering the highest-yield angles.

    Always emits a `site:linkedin.com` query (single highest-authority hit)
    and a generic name+company query. Adds responsibilities/interview
    refiners only when a company is supplied — without it those queries
    return mostly noise.
    """
    name = request.target_name.strip()
    queries: list[str] = [f'"{name}" site:linkedin.com']
    company = (request.company_name or "").strip()
    if company:
        queries.append(f'"{name}" "{company}"')
        queries.append(f'"{name}" "{company}" responsibilities')
    else:
        queries.append(f'"{name}"')
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
    "merge_and_rank",
    "plan_candidates",
]
