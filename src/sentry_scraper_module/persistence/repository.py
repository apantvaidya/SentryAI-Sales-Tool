"""CRUD helpers for the `Tenant` and `Job` tables.

The repository is intentionally a small set of free functions instead of a
class so callers can compose them in either request-scoped sessions
(FastAPI dependency) or worker-scoped sessions (`arq` task) without
inheriting an instance.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from sentry_scraper_module.api.schemas import ProfileRequest
from sentry_scraper_module.core.errors import InvalidRequestError
from sentry_scraper_module.persistence.models import (
    DEFAULT_JOB_TTL,
    DEFAULT_TENANT_ID,
    ApiKey,
    AuditEntry,
    Job,
    JobStatus,
    Suppression,
    Tenant,
    hash_api_key,
    hash_target,
)

# ---------------------------------------------------------------------------
# Tenants
# ---------------------------------------------------------------------------


async def ensure_default_tenant(session: AsyncSession) -> Tenant:
    """Idempotently create and return the bootstrap tenant.

    Phase 4 replaces this with real tenant provisioning behind the API-key
    middleware. For Phase 2 every job is owned by the default tenant so the
    multi-tenant invariant ("every row carries a `tenant_id`") holds before
    auth lands.
    """
    existing = await session.get(Tenant, DEFAULT_TENANT_ID)
    if existing is not None:
        return existing
    tenant = Tenant(id=DEFAULT_TENANT_ID, slug="default", name="Default Tenant")
    session.add(tenant)
    await session.commit()
    await session.refresh(tenant)
    return tenant


async def get_tenant_by_slug(session: AsyncSession, slug: str) -> Tenant | None:
    stmt = select(Tenant).where(Tenant.slug == slug)
    result = await session.exec(stmt)
    return result.first()


async def upsert_tenant(session: AsyncSession, *, slug: str, name: str | None = None) -> Tenant:
    """Idempotently create-or-fetch a tenant by slug."""
    existing = await get_tenant_by_slug(session, slug)
    if existing is not None:
        return existing
    tenant = Tenant(slug=slug, name=name or slug)
    session.add(tenant)
    await session.commit()
    await session.refresh(tenant)
    return tenant


# ---------------------------------------------------------------------------
# Jobs
# ---------------------------------------------------------------------------


async def enqueue_job(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    request: ProfileRequest,
) -> Job:
    """Persist a new job in the `queued` state and return it."""
    job = Job(
        tenant_id=tenant_id,
        request=request.model_dump(mode="json"),
    )
    session.add(job)
    await session.commit()
    await session.refresh(job)
    return job


async def get_job(session: AsyncSession, job_id: uuid.UUID) -> Job | None:
    return await session.get(Job, job_id)


async def get_job_or_raise(session: AsyncSession, job_id: uuid.UUID) -> Job:
    job = await get_job(session, job_id)
    if job is None:
        raise InvalidRequestError(
            f"Job {job_id} not found.",
            details={"job_id": str(job_id)},
        )
    return job


async def mark_running(
    session: AsyncSession,
    job_id: uuid.UUID,
    *,
    now: datetime,
) -> Job:
    job = await get_job_or_raise(session, job_id)
    job.status = JobStatus.running
    job.started_at = now
    await _commit(session, job)
    return job


async def update_stage(
    session: AsyncSession,
    job_id: uuid.UUID,
    *,
    stage: str,
) -> Job:
    job = await get_job_or_raise(session, job_id)
    job.stage = stage
    await _commit(session, job)
    return job


async def mark_done(
    session: AsyncSession,
    job_id: uuid.UUID,
    *,
    result: dict[str, Any],
    now: datetime,
) -> Job:
    job = await get_job_or_raise(session, job_id)
    job.status = JobStatus.done
    job.result = result
    job.completed_at = now
    job.stage = None
    await _commit(session, job)
    return job


async def mark_failed(
    session: AsyncSession,
    job_id: uuid.UUID,
    *,
    error: dict[str, Any],
    now: datetime,
) -> Job:
    job = await get_job_or_raise(session, job_id)
    job.status = JobStatus.failed
    job.error = error
    job.completed_at = now
    await _commit(session, job)
    return job


async def cancel_job(
    session: AsyncSession,
    job_id: uuid.UUID,
    *,
    now: datetime,
) -> Job:
    job = await get_job_or_raise(session, job_id)
    # Cancelling a finished job is a no-op (idempotent) so DELETE is safe to
    # retry from clients.
    if job.status in (JobStatus.done, JobStatus.failed, JobStatus.cancelled):
        return job
    job.status = JobStatus.cancelled
    job.completed_at = now
    await _commit(session, job)
    return job


async def _commit(session: AsyncSession, job: Job) -> None:
    session.add(job)
    await session.commit()
    await session.refresh(job)


# ---------------------------------------------------------------------------
# API keys (Phase 4)
# ---------------------------------------------------------------------------


async def create_api_key(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    plaintext: str,
    label: str = "",
) -> ApiKey:
    """Hash + persist an API key for `tenant_id`. Plaintext is never stored."""
    if not plaintext:
        raise InvalidRequestError("API key cannot be empty.")
    api_key = ApiKey(
        tenant_id=tenant_id,
        key_hash=hash_api_key(plaintext),
        label=label,
    )
    session.add(api_key)
    await session.commit()
    await session.refresh(api_key)
    return api_key


async def find_tenant_by_api_key(
    session: AsyncSession,
    *,
    plaintext: str,
) -> Tenant | None:
    """Resolve an `X-API-Key` value to a `Tenant`, or `None` if no match.

    Revoked keys (where `revoked_at` is set) are ignored. The matching
    row's `last_used_at` is bumped on hit for lightweight observability.
    """
    if not plaintext:
        return None
    key_hash = hash_api_key(plaintext)
    stmt = select(ApiKey).where(ApiKey.key_hash == key_hash)
    result = await session.exec(stmt)
    api_key = result.first()
    if api_key is None or api_key.revoked_at is not None:
        return None

    api_key.last_used_at = datetime.now(tz=api_key.created_at.tzinfo)
    session.add(api_key)
    await session.commit()
    return await session.get(Tenant, api_key.tenant_id)


async def revoke_api_key(
    session: AsyncSession,
    *,
    api_key_id: uuid.UUID,
    now: datetime,
) -> ApiKey | None:
    api_key = await session.get(ApiKey, api_key_id)
    if api_key is None:
        return None
    api_key.revoked_at = now
    session.add(api_key)
    await session.commit()
    await session.refresh(api_key)
    return api_key


# ---------------------------------------------------------------------------
# Suppression list (Phase 4)
# ---------------------------------------------------------------------------


async def add_suppression(
    session: AsyncSession,
    *,
    target_name: str,
    company_name: str | None,
    reason: str = "",
) -> Suppression:
    """Idempotently add a target to the suppression list. Existing rows
    are returned unchanged so repeated erasure requests are no-ops."""
    target_hash = hash_target(target_name, company_name)
    stmt = select(Suppression).where(Suppression.target_hash == target_hash)
    existing = (await session.exec(stmt)).first()
    if existing is not None:
        return existing
    row = Suppression(target_hash=target_hash, reason=reason)
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


async def is_suppressed(
    session: AsyncSession,
    *,
    target_name: str,
    company_name: str | None,
) -> bool:
    target_hash = hash_target(target_name, company_name)
    stmt = select(Suppression).where(Suppression.target_hash == target_hash)
    return (await session.exec(stmt)).first() is not None


async def purge_jobs_for_target(
    session: AsyncSession,
    *,
    target_name: str,
    company_name: str | None,
) -> int:
    """Delete every job whose `request.target_name` + `request.company_name`
    hashes to the same suppression target. Returns the number of rows
    deleted. Used by the erasure endpoint per `docs/DESIGN.md §7.3`.

    We can't filter by `request JSON ->> target_name` portably across
    SQLite + Postgres, so the loop is in Python. Erasure is a low-volume
    admin operation; correctness > throughput.
    """
    target_hash = hash_target(target_name, company_name)
    stmt = select(Job)
    jobs = list((await session.exec(stmt)).all())
    purged = 0
    for job in jobs:
        req = job.request or {}
        if hash_target(req.get("target_name", ""), req.get("company_name")) == target_hash:
            await session.delete(job)
            purged += 1
    if purged:
        await session.commit()
    return purged


# ---------------------------------------------------------------------------
# Audit log (Phase 4)
# ---------------------------------------------------------------------------


async def record_audit_entry(
    session: AsyncSession,
    *,
    event_type: str,
    payload: dict[str, Any] | None = None,
    tenant_id: uuid.UUID | None = None,
    job_id: uuid.UUID | None = None,
) -> AuditEntry:
    """Append a row to the audit log. Append-only — never update or delete."""
    entry = AuditEntry(
        event_type=event_type,
        payload=payload or {},
        tenant_id=tenant_id,
        job_id=job_id,
    )
    session.add(entry)
    await session.commit()
    await session.refresh(entry)
    return entry


async def list_audit_entries(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID | None = None,
    event_type: str | None = None,
    limit: int = 100,
) -> list[AuditEntry]:
    stmt = select(AuditEntry).order_by(AuditEntry.created_at.desc())  # type: ignore[attr-defined]
    if tenant_id is not None:
        stmt = stmt.where(AuditEntry.tenant_id == tenant_id)
    if event_type is not None:
        stmt = stmt.where(AuditEntry.event_type == event_type)
    stmt = stmt.limit(limit)
    return list((await session.exec(stmt)).all())


__all__ = [
    "DEFAULT_JOB_TTL",
    "add_suppression",
    "cancel_job",
    "create_api_key",
    "enqueue_job",
    "ensure_default_tenant",
    "find_tenant_by_api_key",
    "get_job",
    "get_job_or_raise",
    "get_tenant_by_slug",
    "is_suppressed",
    "list_audit_entries",
    "mark_done",
    "mark_failed",
    "mark_running",
    "purge_jobs_for_target",
    "record_audit_entry",
    "revoke_api_key",
    "update_stage",
    "upsert_tenant",
]
