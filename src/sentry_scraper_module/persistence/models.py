"""SQLModel tables for jobs, tenants, and Phase 4 compliance.

Multi-tenant from day one (per `docs/DESIGN.md §12 #9`): every domain row
carries a `tenant_id`. Phase 4 adds `ApiKey` (hashed), `Suppression`
(opt-out list), and `AuditEntry` (append-only event log) alongside the
Phase 2 `Tenant` and `Job` tables.
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Any

from sqlalchemy import JSON, Column, DateTime
from sqlmodel import Field, SQLModel

DEFAULT_JOB_TTL = timedelta(days=7)
DEFAULT_TENANT_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")


def hash_api_key(plaintext: str) -> str:
    """Return `sha256(plaintext)` as 64-char lowercase hex.

    Keys are stored hashed at rest so a DB leak doesn't expose plaintext
    keys. The hash is deterministic so lookup-by-key is a single indexed
    equality query.
    """
    return hashlib.sha256(plaintext.encode("utf-8")).hexdigest()


def hash_target(name: str, company: str | None) -> str:
    """Hash a (target_name, company_name) pair for suppression matches.

    Lowercased + trimmed so casing / whitespace doesn't let a suppressed
    target slip through. Returns 64-char lowercase hex.
    """
    payload = f"{(name or '').strip().lower()}|{(company or '').strip().lower()}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


class JobStatus(StrEnum):
    queued = "queued"
    running = "running"
    done = "done"
    failed = "failed"
    cancelled = "cancelled"


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _expires_at_default() -> datetime:
    return _utc_now() + DEFAULT_JOB_TTL


class Tenant(SQLModel, table=True):
    """An API consumer. One `tenant_id` per logical customer."""

    __tablename__ = "tenants"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    slug: str = Field(unique=True, index=True)
    name: str
    created_at: datetime = Field(
        default_factory=_utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class Job(SQLModel, table=True):
    """An async profile-build job; one row per `POST /v1/profiles`."""

    __tablename__ = "jobs"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    request: dict[str, Any] = Field(sa_column=Column(JSON, nullable=False))
    status: JobStatus = Field(default=JobStatus.queued, index=True)
    stage: str | None = Field(default=None, nullable=True)
    result: dict[str, Any] | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    error: dict[str, Any] | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    created_at: datetime = Field(
        default_factory=_utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    started_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    completed_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    expires_at: datetime = Field(
        default_factory=_expires_at_default,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class ApiKey(SQLModel, table=True):
    """A hashed API key bound to a tenant.

    Plaintext keys are NEVER stored. The auth dependency hashes the
    incoming header value and looks up by `key_hash`. `label` is a
    human-readable hint (e.g. `"prod-2026-q2"`); `last_used_at` is
    bumped opportunistically by the auth path for observability.
    """

    __tablename__ = "api_keys"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    key_hash: str = Field(unique=True, index=True)
    label: str = Field(default="")
    created_at: datetime = Field(
        default_factory=_utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    last_used_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    revoked_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )


class Suppression(SQLModel, table=True):
    """A target that has opted out (or been opted out) of profiling.

    Suppression is global across tenants — a request from any tenant
    that hashes to a stored `target_hash` is refused with 451 before
    any external work happens. Identity is therefore the hash; we keep
    `reason` separately for audit-log enrichment.
    """

    __tablename__ = "suppressions"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    target_hash: str = Field(unique=True, index=True)
    reason: str = Field(default="")
    created_at: datetime = Field(
        default_factory=_utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class AuditEntry(SQLModel, table=True):
    """Append-only compliance event.

    Written by the PII filter for every redaction, by the suppression
    path on a 451 reject, and by the erasure endpoint when records are
    purged. Never updated or deleted.
    """

    __tablename__ = "audit_entries"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    tenant_id: uuid.UUID | None = Field(
        default=None,
        foreign_key="tenants.id",
        index=True,
        nullable=True,
    )
    job_id: uuid.UUID | None = Field(default=None, index=True, nullable=True)
    event_type: str = Field(index=True)
    payload: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSON, nullable=False),
    )
    created_at: datetime = Field(
        default_factory=_utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


__all__ = [
    "DEFAULT_JOB_TTL",
    "DEFAULT_TENANT_ID",
    "ApiKey",
    "AuditEntry",
    "Job",
    "JobStatus",
    "Suppression",
    "Tenant",
    "hash_api_key",
    "hash_target",
]
