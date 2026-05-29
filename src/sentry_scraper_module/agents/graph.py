"""LangGraph wiring for the profile-build pipeline.

The graph mirrors `docs/DESIGN.md §3.2`:

    START -> plan -> fetch_static -> (escalation?) -> fetch_headless -> distill
                                            \\->----------------------> distill
    distill -> chunk -> extract -> finalize -> END

Node implementations are thin wrappers around the pure helpers in
`agents.{planner,scraper,distiller,chunker,extractor,confidence}`. The
runner `run_profile_pipeline` ainvokes the compiled graph and exposes a
`stage_callback` hook so the worker can persist `update_stage` calls
without coupling any node to the database.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, cast

import httpx
from langgraph.graph import END, START, StateGraph

from sentry_scraper_module.agents.chunker import select_relevant_chunks
from sentry_scraper_module.agents.confidence import compute_confidence
from sentry_scraper_module.agents.distiller import distill
from sentry_scraper_module.agents.extractor import extract_profile
from sentry_scraper_module.agents.planner import (
    build_retrieval_queries,
    plan_candidates,
    resolve_plan_budget,
)
from sentry_scraper_module.agents.scraper import (
    fetch_static_many,
    needs_escalation,
)
from sentry_scraper_module.agents.state import ProfileState
from sentry_scraper_module.agents.types import DistilledPage, FetchedPage
from sentry_scraper_module.api.schemas import BuildMetadata
from sentry_scraper_module.core.config import Settings, get_settings
from sentry_scraper_module.core.fingerprint import Fingerprint, build_fingerprint
from sentry_scraper_module.providers.browser import BrowserProvider, StubBrowser
from sentry_scraper_module.providers.embeddings import EmbeddingProvider
from sentry_scraper_module.providers.llm import LLMProvider
from sentry_scraper_module.providers.proxy import ProxySession
from sentry_scraper_module.providers.serp import SerpProvider

StageCallback = Callable[[str], Awaitable[None]]
NODE_NAMES = (
    "plan",
    "fetch_static",
    "fetch_headless",
    "distill",
    "chunk",
    "extract",
    "finalize",
)
SURFACE_CHUNK_TOP_K = 3
DEEP_CHUNK_TOP_K = 5


@dataclass(frozen=True)
class PipelineDeps:
    """Bundle of providers each node needs.

    Construct once per worker run; fakes inject themselves uniformly via
    this single seam. `stage_callback`, if set, is invoked once per node as
    soon as the node starts — it lets the worker persist `update_stage`
    rows without coupling the graph nodes to the DB.

    Phase 3 additions (`browser`, `proxy_session`, `fingerprint`) are
    optional: when omitted, the static path fetches direct without a
    proxy and the headless path uses `StubBrowser` (re-fetch via httpx).
    """

    http_client: httpx.AsyncClient
    serp: SerpProvider
    llm: LLMProvider
    embeddings: EmbeddingProvider
    stage_callback: StageCallback | None = None
    browser: BrowserProvider | None = None
    proxy_session: ProxySession | None = None
    fingerprint: Fingerprint | None = None
    settings: Settings | None = None


async def _emit_stage(deps: PipelineDeps, stage: str) -> None:
    if deps.stage_callback is not None:
        await deps.stage_callback(stage)


# ---------------------------------------------------------------------------
# Node implementations
# ---------------------------------------------------------------------------


def _resolve_settings(deps: PipelineDeps) -> Settings:
    return deps.settings or get_settings()


def _chunk_top_k(state: ProfileState) -> int:
    return DEEP_CHUNK_TOP_K if state["request"].mode == "deep" else SURFACE_CHUNK_TOP_K


def _make_plan_node(deps: PipelineDeps) -> Callable[[ProfileState], Awaitable[dict[str, Any]]]:
    async def plan_node(state: ProfileState) -> dict[str, Any]:
        await _emit_stage(deps, "plan")
        request = state["request"]
        budget = resolve_plan_budget(request.mode, _resolve_settings(deps))
        queries, candidates = await plan_candidates(
            request,
            serp=deps.serp,
            max_candidates=budget.max_candidates,
            results_per_query=budget.results_per_query,
        )
        return {"plan": queries, "candidates": candidates}

    return plan_node


def _resolve_fingerprint(deps: PipelineDeps) -> Fingerprint:
    """Return the configured fingerprint, deriving one from the session
    if only the session was supplied. The scraper has its own fallback
    for the no-config case so it's safe to return that too."""
    if deps.fingerprint is not None:
        return deps.fingerprint
    if deps.proxy_session is not None:
        return build_fingerprint(deps.proxy_session.session_id)
    # The scraper's internal `_FALLBACK_FINGERPRINT` will be used when
    # `fingerprint=None` is forwarded; build the same one here so the
    # headless path stays consistent.
    return build_fingerprint("default")


def _make_fetch_static_node(
    deps: PipelineDeps,
) -> Callable[[ProfileState], Awaitable[dict[str, Any]]]:
    async def fetch_static_node(state: ProfileState) -> dict[str, Any]:
        await _emit_stage(deps, "fetch_static")
        candidates = state["candidates"]
        urls = [c.url for c in candidates]
        if not urls:
            return {"fetched": [], "needs_escalation": False}
        pages = await fetch_static_many(
            urls,
            client=deps.http_client,
            fingerprint=deps.fingerprint,
            session=deps.proxy_session,
        )
        return {"fetched": pages, "needs_escalation": needs_escalation(pages)}

    return fetch_static_node


def _make_fetch_headless_node(
    deps: PipelineDeps,
) -> Callable[[ProfileState], Awaitable[dict[str, Any]]]:
    async def fetch_headless_node(state: ProfileState) -> dict[str, Any]:
        await _emit_stage(deps, "fetch_headless")
        # Re-fetch only the URLs whose static attempt was challenged.
        from sentry_scraper_module.agents.scraper import detect_challenge

        challenged_urls = [
            page.url
            for page in state["fetched"]
            if page.fetched_via == "static" and detect_challenge(page)
        ]
        if not challenged_urls:
            return {}

        browser = deps.browser or StubBrowser(client=deps.http_client)
        session = deps.proxy_session or ProxySession(session_id="default", proxy_url=None)
        fingerprint = _resolve_fingerprint(deps)

        new_pages: list[FetchedPage] = []
        for url in challenged_urls:
            new_pages.append(await browser.render(url, session=session, fingerprint=fingerprint))
        return {"fetched": new_pages}

    return fetch_headless_node


def _make_distill_node(
    deps: PipelineDeps,
) -> Callable[[ProfileState], Awaitable[dict[str, Any]]]:
    async def distill_node(state: ProfileState) -> dict[str, Any]:
        await _emit_stage(deps, "distill")
        distilled: list[DistilledPage] = []
        seen: set[str] = set()
        # Prefer headless versions of any URL that was retried; static rows
        # for the same URL are dropped silently.
        pages = sorted(
            state["fetched"],
            key=lambda p: 0 if p.fetched_via == "headless" else 1,
        )
        for page in pages:
            if page.url in seen or not page.body:
                continue
            seen.add(page.url)
            result = distill(page.body, url=page.url)
            if result is not None:
                distilled.append(result)
        return {"distilled": distilled}

    return distill_node


def _make_chunk_node(
    deps: PipelineDeps,
) -> Callable[[ProfileState], Awaitable[dict[str, Any]]]:
    async def chunk_node(state: ProfileState) -> dict[str, Any]:
        await _emit_stage(deps, "chunk")
        chunks = select_relevant_chunks(
            state["distilled"],
            build_retrieval_queries(state["request"]),
            embeddings=deps.embeddings,
            top_k=_chunk_top_k(state),
        )
        return {"chunks": chunks}

    return chunk_node


def _make_extract_node(
    deps: PipelineDeps,
) -> Callable[[ProfileState], Awaitable[dict[str, Any]]]:
    async def extract_node(state: ProfileState) -> dict[str, Any]:
        await _emit_stage(deps, "extract")
        profile = await extract_profile(
            state["request"],
            state["chunks"],
            llm=deps.llm,
        )
        return {"profile": profile}

    return extract_node


def _make_finalize_node(
    deps: PipelineDeps,
) -> Callable[[ProfileState], Awaitable[dict[str, Any]]]:
    async def finalize_node(state: ProfileState) -> dict[str, Any]:
        await _emit_stage(deps, "finalize")
        profile = state["profile"]
        if profile is None:
            return {}
        sources = [page.url for page in state["distilled"]]
        score, low = compute_confidence(profile, sources)
        metadata = BuildMetadata(
            sources_used=sources,
            confidence_score=score,
            low_confidence=low,
        )
        return {"metadata": metadata}

    return finalize_node


# ---------------------------------------------------------------------------
# Graph builder + runner
# ---------------------------------------------------------------------------


def _route_after_static(state: ProfileState) -> str:
    return "fetch_headless" if state.get("needs_escalation", False) else "distill"


def build_graph(deps: PipelineDeps) -> Any:
    """Compile the LangGraph for the given dependency bundle."""
    graph = StateGraph(ProfileState)
    graph.add_node("plan", _make_plan_node(deps))
    graph.add_node("fetch_static", _make_fetch_static_node(deps))
    graph.add_node("fetch_headless", _make_fetch_headless_node(deps))
    graph.add_node("distill", _make_distill_node(deps))
    graph.add_node("chunk", _make_chunk_node(deps))
    graph.add_node("extract", _make_extract_node(deps))
    graph.add_node("finalize", _make_finalize_node(deps))

    graph.add_edge(START, "plan")
    graph.add_edge("plan", "fetch_static")
    graph.add_conditional_edges(
        "fetch_static",
        _route_after_static,
        {"fetch_headless": "fetch_headless", "distill": "distill"},
    )
    graph.add_edge("fetch_headless", "distill")
    graph.add_edge("distill", "chunk")
    graph.add_edge("chunk", "extract")
    graph.add_edge("extract", "finalize")
    graph.add_edge("finalize", END)
    return graph.compile()


async def run_profile_pipeline(
    initial: ProfileState,
    *,
    deps: PipelineDeps,
) -> ProfileState:
    """Run the compiled graph and return the merged final state.

    Stage tracking happens inside each node via `deps.stage_callback`, so
    the worker can persist `update_stage` rows without coupling node logic
    to the database. We use `ainvoke` (rather than `astream`) so that
    LangGraph applies the `operator.add` reducer on `fetched` / `errors`
    instead of the caller having to merge updates by hand.
    """
    compiled = build_graph(deps)
    final = await compiled.ainvoke(initial)
    return cast(ProfileState, final)


__all__ = [
    "NODE_NAMES",
    "PipelineDeps",
    "StageCallback",
    "build_graph",
    "run_profile_pipeline",
]
