"""Tests for the SQLModel persistence layer.

Runs against an in-memory SQLite engine; the same code paths exercise
Postgres in production thanks to SQLAlchemy's dialect-neutral types.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker
from sqlmodel.ext.asyncio.session import AsyncSession

from sentry_scraper_module.api.schemas import ProfileRequest
from sentry_scraper_module.core.errors import InvalidRequestError
from sentry_scraper_module.persistence.models import (
    DEFAULT_TENANT_ID,
    Job,
    JobStatus,
    Tenant,
)
from sentry_scraper_module.persistence.repository import (
    cancel_job,
    enqueue_job,
    ensure_default_tenant,
    get_job,
    get_job_or_raise,
    get_tenant_by_slug,
    mark_done,
    mark_failed,
    mark_running,
    update_stage,
)


def _now() -> datetime:
    return datetime.now(UTC)


# ---------------------------------------------------------------------------
# Tenant helpers
# ---------------------------------------------------------------------------


async def test_ensure_default_tenant_is_idempotent(session: AsyncSession) -> None:
    # Conftest already called `ensure_default_tenant` once; calling again is
    # a no-op and returns the same row.
    second = await ensure_default_tenant(session)
    assert second.id == DEFAULT_TENANT_ID
    assert second.slug == "default"


async def test_get_tenant_by_slug(session: AsyncSession) -> None:
    found = await get_tenant_by_slug(session, "default")
    assert found is not None
    assert found.id == DEFAULT_TENANT_ID

    missing = await get_tenant_by_slug(session, "does-not-exist")
    assert missing is None


# ---------------------------------------------------------------------------
# Job lifecycle
# ---------------------------------------------------------------------------


async def test_enqueue_job_persists_request_and_defaults_status(
    session: AsyncSession,
) -> None:
    request = ProfileRequest(target_name="Jane Smith", company_name="Acme Corp")
    job = await enqueue_job(session, tenant_id=DEFAULT_TENANT_ID, request=request)

    assert job.status == JobStatus.queued
    assert job.tenant_id == DEFAULT_TENANT_ID
    assert job.request["target_name"] == "Jane Smith"
    assert job.request["company_name"] == "Acme Corp"
    assert job.expires_at > job.created_at
    assert job.started_at is None
    assert job.completed_at is None
    assert job.result is None
    assert job.error is None


async def test_get_job_round_trip(session: AsyncSession) -> None:
    request = ProfileRequest(target_name="Jane Smith")
    enqueued = await enqueue_job(session, tenant_id=DEFAULT_TENANT_ID, request=request)
    fetched = await get_job(session, enqueued.id)
    assert fetched is not None
    assert fetched.id == enqueued.id


async def test_get_job_or_raise_unknown_id(session: AsyncSession) -> None:
    missing_id = uuid.uuid4()
    with pytest.raises(InvalidRequestError, match=str(missing_id)):
        await get_job_or_raise(session, missing_id)


async def test_full_lifecycle_running_to_done(session: AsyncSession) -> None:
    request = ProfileRequest(target_name="Jane Smith")
    job = await enqueue_job(session, tenant_id=DEFAULT_TENANT_ID, request=request)

    running = await mark_running(session, job.id, now=_now())
    assert running.status == JobStatus.running
    assert running.started_at is not None

    staged = await update_stage(session, job.id, stage="extract")
    assert staged.stage == "extract"

    result_payload = {"profile": {"personal": {"name": "Jane Smith"}}}
    done = await mark_done(session, job.id, result=result_payload, now=_now())
    assert done.status == JobStatus.done
    assert done.result == result_payload
    assert done.stage is None
    assert done.completed_at is not None


async def test_full_lifecycle_running_to_failed(session: AsyncSession) -> None:
    request = ProfileRequest(target_name="Jane Smith")
    job = await enqueue_job(session, tenant_id=DEFAULT_TENANT_ID, request=request)

    await mark_running(session, job.id, now=_now())
    error_payload = {
        "code": "UPSTREAM_BLOCKED",
        "message": "all sources gated",
        "retryable": True,
        "details": {},
    }
    failed = await mark_failed(session, job.id, error=error_payload, now=_now())
    assert failed.status == JobStatus.failed
    assert failed.error == error_payload
    assert failed.completed_at is not None


async def test_cancel_job_transitions_when_active(session: AsyncSession) -> None:
    request = ProfileRequest(target_name="Jane Smith")
    job = await enqueue_job(session, tenant_id=DEFAULT_TENANT_ID, request=request)

    cancelled = await cancel_job(session, job.id, now=_now())
    assert cancelled.status == JobStatus.cancelled
    assert cancelled.completed_at is not None


async def test_cancel_job_is_noop_after_terminal_state(
    session: AsyncSession,
) -> None:
    request = ProfileRequest(target_name="Jane Smith")
    job = await enqueue_job(session, tenant_id=DEFAULT_TENANT_ID, request=request)
    await mark_running(session, job.id, now=_now())
    await mark_done(session, job.id, result={"x": 1}, now=_now())

    after = await cancel_job(session, job.id, now=_now())
    assert after.status == JobStatus.done  # unchanged


async def test_session_factory_yields_independent_sessions(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    request = ProfileRequest(target_name="Jane Smith")
    async with session_factory() as s1:
        await ensure_default_tenant(s1)
        job = await enqueue_job(s1, tenant_id=DEFAULT_TENANT_ID, request=request)

    # A fresh session should still see the committed row.
    async with session_factory() as s2:
        fetched = await get_job(s2, job.id)
        assert fetched is not None


async def test_job_table_metadata_is_present() -> None:
    # Sanity that SQLModel registered the tables we expect.
    table_names = {Tenant.__tablename__, Job.__tablename__}
    assert table_names == {"tenants", "jobs"}
