"""Embedding provider abstraction.

The chunker uses these to rank distilled chunks against a target query. The
production adapter is a lazily loaded `sentence-transformers/all-MiniLM-L6-v2`
model; tests use the deterministic `HashEmbeddings` so they need neither
the heavy `[ml]` extra nor any network.
"""

from __future__ import annotations

import hashlib
from collections.abc import Sequence
from typing import Any, Protocol, cast

import numpy as np
from numpy.typing import NDArray

EmbeddingMatrix = NDArray[np.float32]


class EmbeddingProvider(Protocol):
    """Synchronous embedding API.

    All providers must return L2-normalised vectors so cosine similarity
    reduces to a single matrix-vector dot product downstream.
    """

    @property
    def dim(self) -> int: ...

    def embed(self, texts: Sequence[str]) -> EmbeddingMatrix: ...


# ---------------------------------------------------------------------------
# Deterministic hash-based fake (test default).
# ---------------------------------------------------------------------------


class HashEmbeddings:
    """Bag-of-tokens hashing embeddings.

    Token i contributes a +1 to bucket `hash(i) % dim`, then we L2-normalise.
    Not semantic, but stable, fast, dependency-free, and good enough for
    chunk-ranking tests where lexical overlap with the query is what we want
    to verify.
    """

    def __init__(self, dim: int = 64) -> None:
        if dim <= 0:
            raise ValueError("dim must be positive")
        self._dim = dim

    @property
    def dim(self) -> int:
        return self._dim

    def embed(self, texts: Sequence[str]) -> EmbeddingMatrix:
        out = np.zeros((len(texts), self._dim), dtype=np.float32)
        for row, text in enumerate(texts):
            for token in _tokenize(text):
                bucket = _bucket(token, self._dim)
                out[row, bucket] += 1.0
        norms = np.linalg.norm(out, axis=1, keepdims=True)
        norms = np.where(norms == 0.0, 1.0, norms)
        return cast(EmbeddingMatrix, (out / norms).astype(np.float32))


def _tokenize(text: str) -> list[str]:
    return [tok for tok in text.lower().split() if tok]


def _bucket(token: str, dim: int) -> int:
    digest = hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest()
    return int.from_bytes(digest, "little") % dim


# ---------------------------------------------------------------------------
# Lazy SentenceTransformer adapter (production).
# ---------------------------------------------------------------------------


class SentenceTransformerEmbeddings:
    """Wraps `sentence-transformers/all-MiniLM-L6-v2` with lazy loading.

    The model (~80 MB) is loaded on first `embed()` so process startup stays
    fast and CI need not install the `[ml]` extra.
    """

    def __init__(
        self,
        model_name: str = "sentence-transformers/all-MiniLM-L6-v2",
    ) -> None:
        self._model_name = model_name
        self._model: Any = None
        self._dim_cache: int | None = None

    @property
    def dim(self) -> int:
        if self._dim_cache is None:
            self._ensure_model()
        assert self._dim_cache is not None
        return self._dim_cache

    def embed(self, texts: Sequence[str]) -> EmbeddingMatrix:
        model = self._ensure_model()
        result = model.encode(
            list(texts),
            convert_to_numpy=True,
            normalize_embeddings=True,
        )
        return cast(EmbeddingMatrix, np.asarray(result, dtype=np.float32))

    def _ensure_model(self) -> Any:
        if self._model is None:
            try:
                from sentence_transformers import SentenceTransformer
            except ImportError as exc:
                raise RuntimeError(
                    'sentence-transformers is not installed. Install with `pip install -e ".[ml]"`.'
                ) from exc
            self._model = SentenceTransformer(self._model_name)
            self._dim_cache = int(self._model.get_sentence_embedding_dimension())
        return self._model


# ---------------------------------------------------------------------------
# Default factory.
# ---------------------------------------------------------------------------


def default_embeddings() -> EmbeddingProvider:
    """Return a real semantic embedder if available, else `HashEmbeddings`."""
    try:
        import sentence_transformers  # noqa: F401
    except ImportError:
        return HashEmbeddings()
    return SentenceTransformerEmbeddings()


__all__ = [
    "EmbeddingMatrix",
    "EmbeddingProvider",
    "HashEmbeddings",
    "SentenceTransformerEmbeddings",
    "default_embeddings",
]
