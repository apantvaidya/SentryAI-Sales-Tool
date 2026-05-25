"""Public API I/O schemas.

Mirrors the PRD output schema verbatim. Keep these models stable: every
extraction-time and orchestration-time component depends on the field names
matching the documented contract.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl


class ProfileRequest(BaseModel):
    """Inbound payload for `POST /v1/profiles` (see `docs/PRD.md §2.1`)."""

    model_config = ConfigDict(extra="forbid")

    target_name: str = Field(..., min_length=1)
    company_name: str | None = None
    seed_urls: list[HttpUrl] = Field(default_factory=list)
    context_goal: str | None = None


# ---------------------------------------------------------------------------
# Profile sub-sections.
#
# Defaults are empty strings / empty lists rather than `None` so the LLM
# extractor can fill in known values and leave the rest untouched without
# having to special-case nullability. The provider helper
# `strict_json_schema()` then promotes every property to "required" for
# OpenAI structured-output compatibility.
# ---------------------------------------------------------------------------


class PersonalSection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = ""
    exact_location: str = ""
    interests: list[str] = Field(default_factory=list)


class ProfessionalSection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = ""
    company: str = ""
    responsibilities: list[str] = Field(default_factory=list)
    reports_to: str = ""
    oversees: list[str] = Field(default_factory=list)
    cost_metrics: str = ""


class ContactSection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    best_channels: list[str] = Field(default_factory=list)
    emails: list[str] = Field(default_factory=list)
    social_links: list[str] = Field(default_factory=list)


class OutreachStrategy(BaseModel):
    model_config = ConfigDict(extra="forbid")
    pain_points: list[str] = Field(default_factory=list)
    how_we_benefit_them: str = ""


class Profile(BaseModel):
    """The structured profile returned to API callers (and produced by the LLM)."""

    model_config = ConfigDict(extra="forbid")

    personal: PersonalSection = Field(default_factory=PersonalSection)
    professional: ProfessionalSection = Field(default_factory=ProfessionalSection)
    contact: ContactSection = Field(default_factory=ContactSection)
    outreach_strategy: OutreachStrategy = Field(default_factory=OutreachStrategy)


class BuildMetadata(BaseModel):
    """Per-build observability metadata."""

    model_config = ConfigDict(extra="forbid")

    sources_used: list[str] = Field(default_factory=list)
    confidence_score: float = 0.0
    low_confidence: bool = False


class ProfileResult(BaseModel):
    """Top-level response body for a finished profile build."""

    model_config = ConfigDict(extra="forbid")

    profile: Profile
    metadata: BuildMetadata


# ---------------------------------------------------------------------------
# Async-with-polling job-control envelopes (see `docs/DESIGN.md §3.1`).
# ---------------------------------------------------------------------------


JobStatusLiteral = Literal["queued", "running", "done", "failed", "cancelled"]


class JobAccepted(BaseModel):
    """`202 Accepted` envelope returned by `POST /v1/profiles`."""

    model_config = ConfigDict(extra="forbid")

    job_id: uuid.UUID
    status: JobStatusLiteral = "queued"
    poll_url: str


class JobError(BaseModel):
    """Wire shape of the `error` field on a failed job."""

    model_config = ConfigDict(extra="forbid")

    code: str
    message: str
    stage: str | None = None
    retryable: bool = False
    details: dict[str, object] = Field(default_factory=dict)


class JobStatusResponse(BaseModel):
    """`GET /v1/profiles/{job_id}` envelope.

    `result` is populated only on `done`; `error` only on `failed`. `stage`
    reflects the most recent pipeline node.
    """

    model_config = ConfigDict(extra="forbid")

    job_id: uuid.UUID
    status: JobStatusLiteral
    stage: str | None = None
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
    expires_at: datetime
    result: ProfileResult | None = None
    error: JobError | None = None


# ---------------------------------------------------------------------------
# Erasure (Phase 4)
# ---------------------------------------------------------------------------


class ErasureRequest(BaseModel):
    """`DELETE /v1/erasure` payload.

    Either `(target_name, company_name)` or `email` must be provided.
    The endpoint hashes the identity, adds it to the suppression list,
    and purges matching cached jobs.
    """

    model_config = ConfigDict(extra="forbid")

    target_name: str | None = None
    company_name: str | None = None
    email: str | None = None
    reason: str = ""


class ErasureResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    accepted: bool
    target_hash: str
    purged_job_count: int


__all__ = [
    "BuildMetadata",
    "ContactSection",
    "ErasureRequest",
    "ErasureResponse",
    "JobAccepted",
    "JobError",
    "JobStatusLiteral",
    "JobStatusResponse",
    "OutreachStrategy",
    "PersonalSection",
    "ProfessionalSection",
    "Profile",
    "ProfileRequest",
    "ProfileResult",
]
