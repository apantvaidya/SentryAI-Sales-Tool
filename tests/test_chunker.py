"""Tests for the chunking + retrieval stage."""

from __future__ import annotations

from sentry_scraper_module.agents.chunker import (
    DEFAULT_PAGE_TOKEN_THRESHOLD,
    select_relevant_chunks,
)
from sentry_scraper_module.agents.types import DistilledPage
from sentry_scraper_module.providers.embeddings import HashEmbeddings


def _short_page(url: str, text: str) -> DistilledPage:
    return DistilledPage(url=url, markdown=text, word_count=len(text.split()))


def test_empty_pages_return_empty(hash_embeddings: HashEmbeddings) -> None:
    assert select_relevant_chunks([], "anything", embeddings=hash_embeddings) == []


def test_short_pages_pass_through_with_max_similarity(
    hash_embeddings: HashEmbeddings,
) -> None:
    pages = [_short_page("u1", "Jane Smith leads engineering at Acme.")]
    chunks = select_relevant_chunks(pages, "Jane Smith", embeddings=hash_embeddings)
    assert len(chunks) == 1
    assert chunks[0].similarity == 1.0
    assert chunks[0].text == pages[0].markdown


def test_top_k_ranks_relevant_chunks_first(hash_embeddings: HashEmbeddings) -> None:
    pages: list[DistilledPage] = [
        _short_page(f"u{i}", f"unrelated chunk number {i} about gardening tools") for i in range(5)
    ]
    pages.append(_short_page("u-target", "Jane Smith VP of Engineering at Acme Corp"))
    chunks = select_relevant_chunks(
        pages,
        "Jane Smith VP Engineering",
        embeddings=hash_embeddings,
        top_k=2,
    )
    assert len(chunks) == 2
    assert any(c.page_url == "u-target" for c in chunks)
    # Relevant chunk should rank higher than the gardening filler.
    target = next(c for c in chunks if c.page_url == "u-target")
    other = next(c for c in chunks if c.page_url != "u-target")
    assert target.similarity >= other.similarity


def test_long_page_is_split_and_ranked(hash_embeddings: HashEmbeddings) -> None:
    long_text = (
        "Jane Smith is the VP of Engineering at Acme Corp. " * 200
        + "Filler content about gardening and unrelated topics. " * 200
    )
    long_page = DistilledPage(url="u-long", markdown=long_text, word_count=4000)
    chunks = select_relevant_chunks(
        [long_page],
        "Jane Smith VP Engineering",
        embeddings=hash_embeddings,
        top_k=3,
    )
    assert 0 < len(chunks) <= 3
    # All returned chunks should be from the same source page.
    assert all(c.page_url == "u-long" for c in chunks)


def test_below_threshold_skips_splitting(hash_embeddings: HashEmbeddings) -> None:
    """A page below the token threshold is fed in whole, even with top_k > 1."""
    text = "Short page about Jane Smith at Acme Corp."
    page = _short_page("u-short", text)
    chunks = select_relevant_chunks(
        [page],
        "Jane Smith",
        embeddings=hash_embeddings,
        top_k=3,
        page_token_threshold=DEFAULT_PAGE_TOKEN_THRESHOLD,
    )
    assert len(chunks) == 1
    assert chunks[0].text == text


def test_multi_query_selection_surfaces_identity_and_challenge_evidence(
    hash_embeddings: HashEmbeddings,
) -> None:
    pages = [
        _short_page(
            "u-role",
            "Jane Smith is VP of Engineering at Acme Corp and owns the platform roadmap.",
        ),
        _short_page(
            "u-challenges",
            "Acme Corp says handoff costs, shipping delays, and platform "
            "bottlenecks are top priorities.",
        ),
        _short_page("u-noise", "Gardening tools and backyard irrigation trends."),
    ]
    chunks = select_relevant_chunks(
        pages,
        [
            "Jane Smith Acme Corp responsibilities roadmap",
            "Acme Corp challenges bottlenecks priorities",
        ],
        embeddings=hash_embeddings,
        top_k=2,
    )

    urls = {chunk.page_url for chunk in chunks}
    assert urls == {"u-role", "u-challenges"}
