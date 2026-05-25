"""Agent-internal data types shared across pipeline stages.

These are distinct from the public API schemas in `api/schemas.py`: they
hold intermediate state (raw fetch bodies, distilled markdown, ranked
chunks) that never leaves the worker process. Phase 2's LangGraph state
will consume these directly.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict


class FetchedPage(BaseModel):
    """Raw response captured by the static or headless fetcher."""

    model_config = ConfigDict(extra="forbid")

    url: str
    status: int
    body: str
    fetched_via: Literal["static", "headless"] = "static"
    bytes_in: int = 0


class DistilledPage(BaseModel):
    """Output of the distillation stage — boilerplate stripped, Markdown."""

    model_config = ConfigDict(extra="forbid")

    url: str
    markdown: str
    title: str | None = None
    word_count: int


class Chunk(BaseModel):
    """A retrieval-ranked excerpt fed to the extractor."""

    model_config = ConfigDict(extra="forbid")

    page_url: str
    text: str
    similarity: float


__all__ = ["Chunk", "DistilledPage", "FetchedPage"]
