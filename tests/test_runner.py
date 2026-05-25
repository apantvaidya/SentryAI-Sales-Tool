"""Unit tests for `worker.runner.execute_job`.

Exercises the runner directly (no HTTP) against a real session factory
and stubbed providers, so we can assert on the persisted Job rows after
each terminal transition.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker
from sqlmodel.ext.asyncio.session import AsyncSession

from sentry_scraper_module.api.schemas import (
    PersonalSection,
    ProfessionalSection,
    Profile,
    ProfileRequest,
)
from sentry_scraper_module.persistence.models import DEFAULT_TENANT_ID, JobStatus
from sentry_scraper_module.persistence.repository import (
    enqueue_job,
    ensure_default_tenant,
    get_job_or_raise,
)
from sentry_scraper_module.providers.embeddings import HashEmbeddings
from sentry_scraper_module.providers.llm import FakeLLM
from sentry_scraper_module.providers.serp import FakeSerp, SerpResult
from sentry_scraper_module.worker.runner import RunDeps, execute_job


def _serve_one(url: str, body: str) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        if str(request.url) == url:
            return httpx.Response(200, html=body)
        return httpx.Response(404, content=b"missing")

    return httpx.MockTransport(handler)


def _serp_for(url: str) -> FakeSerp:
    serp = FakeSerp({})

    async def _search(query: str, *, num: int = 10) -> list[SerpResult]:
        serp.calls.append(query)
        return [SerpResult(url=url, title=url, position=1)][:num]

    serp.search = _search  # type: ignore[method-assign]
    return serp


def _canned_profile() -> Profile:
    return Profile(
        personal=PersonalSection(name="Jane Smith"),
        professional=ProfessionalSection(title="VP of Engineering", company="Acme Corp"),
    )


@pytest.fixture
def url() -> str:
    return "https://linkedin.com/in/jane-smith"


@pytest.fixture
def fixture_body(fixture_html: dict[str, str]) -> str:
    return fixture_html["linkedin_profile"]


async def test_execute_job_marks_done_with_full_result(
    session_factory: async_sessionmaker[AsyncSession],
    url: str,
    fixture_body: str,
) -> None:
    async with session_factory() as session:
        await ensure_default_tenant(session)
        job = await enqueue_job(
            session,
            tenant_id=DEFAULT_TENANT_ID,
            request=ProfileRequest(target_name="Jane Smith"),
        )

    transport = _serve_one(url, fixture_body)

    @asynccontextmanager
    async def deps_factory() -> AsyncIterator[RunDeps]:
        async with httpx.AsyncClient(transport=transport) as client:
            yield RunDeps(
                http_client=client,
                serp=_serp_for(url),
                llm=FakeLLM(_canned_profile()),
                embeddings=HashEmbeddings(dim=64),
            )

    await execute_job(
        job.id,
        session_factory=session_factory,
        deps_factory=deps_factory,
    )

    async with session_factory() as session:
        final = await get_job_or_raise(session, job.id)

    assert final.status == JobStatus.done
    assert final.error is None
    assert final.completed_at is not None
    assert final.result is not None
    assert final.result["profile"]["personal"]["name"] == "Jane Smith"


async def test_execute_job_wraps_unexpected_exceptions(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as session:
        await ensure_default_tenant(session)
        job = await enqueue_job(
            session,
            tenant_id=DEFAULT_TENANT_ID,
            request=ProfileRequest(target_name="Jane Smith"),
        )

    @asynccontextmanager
    async def exploding_deps() -> AsyncIterator[RunDeps]:
        raise RuntimeError("boom")
        yield  # pragma: no cover - unreachable; needed for type-shape

    await execute_job(
        job.id,
        session_factory=session_factory,
        deps_factory=exploding_deps,
    )

    async with session_factory() as session:
        final = await get_job_or_raise(session, job.id)

    assert final.status == JobStatus.failed
    assert final.error is not None
    assert final.error["code"] == "INTERNAL"
    # The wrapped message preserves the original error text for debugging.
    assert "boom" in final.error["message"]


async def test_execute_job_marks_failed_when_target_suppressed_mid_flight(
    session_factory: async_sessionmaker[AsyncSession],
    url: str,
    fixture_body: str,
) -> None:
    """If the target lands on the suppression list while the pipeline runs,
    the runner's post-extraction re-check discards the profile and marks
    the job failed with `SUPPRESSED`. We simulate the race by suppressing
    the target *before* execute_job runs — the worker still re-checks at
    the end and bails out."""
    from sentry_scraper_module.persistence.repository import add_suppression

    async with session_factory() as session:
        await ensure_default_tenant(session)
        job = await enqueue_job(
            session,
            tenant_id=DEFAULT_TENANT_ID,
            request=ProfileRequest(target_name="Jane Smith", company_name="Acme"),
        )
        # Suppress after enqueue (mimicking an erasure that lands while the
        # pipeline is in flight). The POST handler did NOT see this row.
        await add_suppression(session, target_name="Jane Smith", company_name="Acme")

    transport = _serve_one(url, fixture_body)

    @asynccontextmanager
    async def deps_factory() -> AsyncIterator[RunDeps]:
        async with httpx.AsyncClient(transport=transport) as client:
            yield RunDeps(
                http_client=client,
                serp=_serp_for(url),
                llm=FakeLLM(_canned_profile()),
                embeddings=HashEmbeddings(dim=64),
            )

    await execute_job(
        job.id,
        session_factory=session_factory,
        deps_factory=deps_factory,
    )

    async with session_factory() as session:
        final = await get_job_or_raise(session, job.id)

    assert final.status == JobStatus.failed
    assert final.error is not None
    assert final.error["code"] == "SUPPRESSED"
    # No profile result is persisted — suppressed targets leave no trace.
    assert final.result is None


async def test_execute_job_redacts_pii_before_persisting(
    session_factory: async_sessionmaker[AsyncSession],
    url: str,
    fixture_body: str,
) -> None:
    """A dirty profile from the LLM is scrubbed before `mark_done` writes the
    result row, and an audit entry is recorded."""
    from sentry_scraper_module.api.schemas import (
        ContactSection,
        OutreachStrategy,
    )
    from sentry_scraper_module.compliance.audit import EVENT_PII_REDACTION
    from sentry_scraper_module.persistence.repository import list_audit_entries

    dirty = Profile(
        personal=PersonalSection(name="Jane Smith"),
        professional=ProfessionalSection(
            title="VP of Engineering",
            company="Acme",
            cost_metrics="Manages $5M; recovering from cancer.",
        ),
        contact=ContactSection(),
        outreach_strategy=OutreachStrategy(),
    )

    async with session_factory() as session:
        await ensure_default_tenant(session)
        job = await enqueue_job(
            session,
            tenant_id=DEFAULT_TENANT_ID,
            request=ProfileRequest(target_name="Jane Smith"),
        )

    transport = _serve_one(url, fixture_body)

    @asynccontextmanager
    async def deps_factory() -> AsyncIterator[RunDeps]:
        async with httpx.AsyncClient(transport=transport) as client:
            yield RunDeps(
                http_client=client,
                serp=_serp_for(url),
                llm=FakeLLM(dirty),
                embeddings=HashEmbeddings(dim=64),
            )

    await execute_job(
        job.id,
        session_factory=session_factory,
        deps_factory=deps_factory,
    )

    async with session_factory() as session:
        final = await get_job_or_raise(session, job.id)
        audit_rows = await list_audit_entries(session, event_type=EVENT_PII_REDACTION)

    assert final.status == JobStatus.done
    assert final.result is not None
    cost_metrics = final.result["profile"]["professional"]["cost_metrics"]
    assert "cancer" not in cost_metrics.lower()
    assert "[redacted:health]" in cost_metrics
    assert len(audit_rows) == 1
    assert audit_rows[0].payload["count"] >= 1


async def test_execute_job_skips_terminal_jobs(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    """If the job is already done/failed/cancelled, execute_job is a no-op."""
    from datetime import UTC, datetime

    from sentry_scraper_module.persistence.repository import (
        mark_done,
        mark_running,
    )

    async with session_factory() as session:
        await ensure_default_tenant(session)
        job = await enqueue_job(
            session,
            tenant_id=DEFAULT_TENANT_ID,
            request=ProfileRequest(target_name="Jane Smith"),
        )
        await mark_running(session, job.id, now=datetime.now(UTC))
        await mark_done(
            session,
            job.id,
            result={"profile": {"personal": {"name": "Already done"}}},
            now=datetime.now(UTC),
        )

    @asynccontextmanager
    async def should_not_be_called() -> AsyncIterator[RunDeps]:
        raise AssertionError("deps_factory must not run for terminal jobs")
        yield  # pragma: no cover

    await execute_job(
        job.id,
        session_factory=session_factory,
        deps_factory=should_not_be_called,
    )

    async with session_factory() as session:
        final = await get_job_or_raise(session, job.id)
    # Untouched.
    assert final.status == JobStatus.done
    assert final.result == {"profile": {"personal": {"name": "Already done"}}}
