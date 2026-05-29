"""Semantic chunking + retrieval.

Pages whose token estimate exceeds `page_token_threshold` are split into
overlapping windows; everything else is passed through whole. The combined
candidate set is then ranked against a query string (target name + role)
using cosine similarity over L2-normalised embeddings, and the top-k
chunks are returned.

This stage is a hard gate for token efficiency: the extractor only ever
sees the chunks that survive selection.
"""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np
from langchain_text_splitters import RecursiveCharacterTextSplitter
from numpy.typing import NDArray

from sentry_scraper_module.agents.types import Chunk, DistilledPage
from sentry_scraper_module.providers.embeddings import EmbeddingProvider

# A pragmatic char-to-token rule of thumb. Real LLM token counters live in
# `litellm.token_counter`; this estimator is only used for the local
# threshold decision and an off-by-2x error is harmless here.
_CHARS_PER_TOKEN = 4

DEFAULT_CHUNK_CHARS = 2000
DEFAULT_CHUNK_OVERLAP = 200
DEFAULT_PAGE_TOKEN_THRESHOLD = 3000
DEFAULT_TOP_K = 3


def select_relevant_chunks(
    pages: Sequence[DistilledPage],
    query: str | Sequence[str],
    *,
    embeddings: EmbeddingProvider,
    top_k: int = DEFAULT_TOP_K,
    page_token_threshold: int = DEFAULT_PAGE_TOKEN_THRESHOLD,
    chunk_chars: int = DEFAULT_CHUNK_CHARS,
    chunk_overlap: int = DEFAULT_CHUNK_OVERLAP,
) -> list[Chunk]:
    """Return up to `top_k` chunks best matching `query`.

    `query` can be either a single retrieval intent or a small set of intents.
    When multiple intents are supplied we rank against each, then merge the
    rankings round-robin so one "who is this?" query cannot crowd out all of
    the "what are their priorities/challenges?" evidence.
    """
    candidates = _build_candidates(
        pages,
        page_token_threshold=page_token_threshold,
        chunk_chars=chunk_chars,
        chunk_overlap=chunk_overlap,
    )
    if not candidates:
        return []

    if len(candidates) <= top_k:
        return [Chunk(page_url=url, text=text, similarity=1.0) for url, text in candidates]

    queries = _normalise_queries(query)
    chunk_vecs = embeddings.embed([text for _, text in candidates])
    query_vecs = embeddings.embed(queries)
    sims = chunk_vecs @ query_vecs.T  # both sides are L2-normalised

    if len(queries) == 1:
        ranked_idx = np.argsort(-sims[:, 0])[:top_k]
        return [
            Chunk(
                page_url=candidates[i][0],
                text=candidates[i][1],
                similarity=float(sims[i, 0]),
            )
            for i in ranked_idx
        ]

    selected_idx = _merge_rankings(candidates, sims, top_k=top_k)
    max_scores = sims.max(axis=1)
    return [
        Chunk(
            page_url=candidates[i][0],
            text=candidates[i][1],
            similarity=float(max_scores[i]),
        )
        for i in selected_idx
    ]


def _build_candidates(
    pages: Sequence[DistilledPage],
    *,
    page_token_threshold: int,
    chunk_chars: int,
    chunk_overlap: int,
) -> list[tuple[str, str]]:
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_chars,
        chunk_overlap=chunk_overlap,
        length_function=len,
        separators=["\n\n", "\n", ". ", " ", ""],
    )
    candidates: list[tuple[str, str]] = []
    for page in pages:
        if _estimated_tokens(page.markdown) <= page_token_threshold:
            candidates.append((page.url, page.markdown))
            continue
        for piece in splitter.split_text(page.markdown):
            piece = piece.strip()
            if piece:
                candidates.append((page.url, piece))
    return candidates


def _normalise_queries(query: str | Sequence[str]) -> list[str]:
    raw_queries = [query] if isinstance(query, str) else list(query)

    seen: set[str] = set()
    cleaned: list[str] = []
    for item in raw_queries:
        normalised = " ".join(item.split())
        if not normalised or normalised in seen:
            continue
        seen.add(normalised)
        cleaned.append(normalised)
    return cleaned or [""]


def _merge_rankings(
    candidates: Sequence[tuple[str, str]],
    sims: NDArray[np.float32],
    *,
    top_k: int,
) -> list[int]:
    """Interleave per-query rankings with an early bias toward page diversity."""
    rankings = [np.argsort(-sims[:, i]) for i in range(sims.shape[1])]
    chosen: list[int] = []
    chosen_set: set[int] = set()
    chosen_pages: set[str] = set()

    while len(chosen) < top_k:
        progressed = False
        for ranking in rankings:
            idx = _pick_ranked_candidate(
                ranking,
                candidates,
                chosen_set=chosen_set,
                chosen_pages=chosen_pages,
                prefer_new_page=True,
            )
            if idx is None:
                continue
            chosen.append(idx)
            chosen_set.add(idx)
            chosen_pages.add(candidates[idx][0])
            progressed = True
            if len(chosen) >= top_k:
                break
        if not progressed:
            break

    if len(chosen) < top_k:
        global_scores = sims.max(axis=1)
        for idx in np.argsort(-global_scores):
            idx_int = int(idx)
            if idx_int in chosen_set:
                continue
            chosen.append(idx_int)
            chosen_set.add(idx_int)
            if len(chosen) >= top_k:
                break
    return chosen


def _pick_ranked_candidate(
    ranking: NDArray[np.int64],
    candidates: Sequence[tuple[str, str]],
    *,
    chosen_set: set[int],
    chosen_pages: set[str],
    prefer_new_page: bool,
) -> int | None:
    fallback: int | None = None
    for idx in ranking:
        idx_int = int(idx)
        if idx_int in chosen_set:
            continue
        page_url = candidates[idx_int][0]
        if prefer_new_page and page_url in chosen_pages:
            if fallback is None:
                fallback = idx_int
            continue
        return idx_int
    return fallback


def _estimated_tokens(text: str) -> int:
    return len(text) // _CHARS_PER_TOKEN


__all__ = [
    "DEFAULT_CHUNK_CHARS",
    "DEFAULT_CHUNK_OVERLAP",
    "DEFAULT_PAGE_TOKEN_THRESHOLD",
    "DEFAULT_TOP_K",
    "select_relevant_chunks",
]
