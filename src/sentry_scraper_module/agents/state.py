"""LangGraph state schema and supporting Pydantic models.

`ProfileState` is the single value that flows through the graph. Each node
returns a partial dict; LangGraph merges it into the running state. Lists
are annotated with `operator.add` so multiple nodes can append without
clobbering each other (e.g. `errors`).
"""

from __future__ import annotations

import operator
from typing import Annotated, Literal, TypedDict

from pydantic import BaseModel, ConfigDict

from sentry_scraper_module.agents.types import Chunk, DistilledPage, FetchedPage
from sentry_scraper_module.api.schemas import (
    BuildMetadata,
    Profile,
    ProfileRequest,
)
from sentry_scraper_module.core.errors import ErrorBody


class CandidateUrl(BaseModel):
    """A planner-ranked URL waiting to be fetched."""

    model_config = ConfigDict(extra="forbid")

    url: str
    source: Literal["seed", "serp"]
    serp_position: int | None = None
    authority_tier: float = 0.0
    query: str | None = None


class ProfileState(TypedDict):
    """Mutable graph state.

    Producer notes:
    - `plan` lists the queries the planner generated (for debugging).
    - `candidates` is the deduped + ranked URL set the fetchers consume.
    - `fetched` accumulates one entry per URL fetched (static or headless);
      annotated with `operator.add` so the conditional headless branch can
      *append* its retries instead of replacing the static results.
    - `needs_escalation` flips to True when the static fetcher detected a
      challenge / block on at least one candidate.
    - `errors` accumulates non-fatal node errors via `operator.add`.

    All fields are present from the start (built by `initial_state`); we use
    `total=True` so LangGraph's typing stubs accept the schema cleanly.
    """

    request: ProfileRequest
    plan: list[str]
    candidates: list[CandidateUrl]
    fetched: Annotated[list[FetchedPage], operator.add]
    distilled: list[DistilledPage]
    chunks: list[Chunk]
    profile: Profile | None
    metadata: BuildMetadata | None
    needs_escalation: bool
    errors: Annotated[list[ErrorBody], operator.add]


def initial_state(request: ProfileRequest) -> ProfileState:
    """Build a fresh state with sensible empty defaults."""
    return ProfileState(
        request=request,
        plan=[],
        candidates=[],
        fetched=[],
        distilled=[],
        chunks=[],
        profile=None,
        metadata=None,
        needs_escalation=False,
        errors=[],
    )


__all__ = ["CandidateUrl", "ProfileState", "initial_state"]
