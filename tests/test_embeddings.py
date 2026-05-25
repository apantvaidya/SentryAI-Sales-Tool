"""Tests for the embedding provider implementations."""

from __future__ import annotations

import numpy as np
import pytest

from sentry_scraper_module.providers.embeddings import (
    HashEmbeddings,
    SentenceTransformerEmbeddings,
    default_embeddings,
)


def test_hash_embeddings_dim_property() -> None:
    embedder = HashEmbeddings(dim=32)
    assert embedder.dim == 32


def test_hash_embeddings_shape() -> None:
    embedder = HashEmbeddings(dim=64)
    matrix = embedder.embed(["hello world", "another doc"])
    assert matrix.shape == (2, 64)
    assert matrix.dtype == np.float32


def test_hash_embeddings_deterministic() -> None:
    embedder = HashEmbeddings(dim=32)
    a = embedder.embed(["the same text"])
    b = embedder.embed(["the same text"])
    np.testing.assert_array_equal(a, b)


def test_hash_embeddings_l2_normalised() -> None:
    embedder = HashEmbeddings(dim=32)
    matrix = embedder.embed(["alpha bravo charlie delta"])
    norms = np.linalg.norm(matrix, axis=1)
    np.testing.assert_allclose(norms, 1.0, atol=1e-5)


def test_hash_embeddings_handles_empty_string() -> None:
    embedder = HashEmbeddings(dim=16)
    matrix = embedder.embed([""])
    assert matrix.shape == (1, 16)
    np.testing.assert_array_equal(matrix, np.zeros_like(matrix))


def test_hash_embeddings_lexical_overlap_increases_similarity() -> None:
    embedder = HashEmbeddings(dim=128)
    query = embedder.embed(["jane smith vp engineering"])[0]
    docs = embedder.embed(
        [
            "jane smith vp of engineering at acme",
            "completely unrelated content about gardening",
        ]
    )
    sims = docs @ query
    assert sims[0] > sims[1]


def test_hash_embeddings_rejects_non_positive_dim() -> None:
    with pytest.raises(ValueError):
        HashEmbeddings(dim=0)


def test_default_embeddings_is_callable() -> None:
    embedder = default_embeddings()
    assert hasattr(embedder, "embed")
    assert hasattr(embedder, "dim")


def test_sentence_transformer_lazy_raises_when_extra_missing() -> None:
    """If the optional `[ml]` extra is not installed, calling embed() raises."""
    embedder = SentenceTransformerEmbeddings()
    try:
        import sentence_transformers  # noqa: F401
    except ImportError:
        with pytest.raises(RuntimeError, match=r"\[ml\]"):
            embedder.embed(["test"])
    else:
        pytest.skip("sentence-transformers is installed; lazy-import path is not tested")
