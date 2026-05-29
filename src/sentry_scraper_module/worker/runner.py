"""Job execution loop.

Given a `Job.id`, the runner loads the persisted request, drives the
LangGraph pipeline, and writes the final `result`/`error` row back. The
queue layer (arq or in-process) is responsible for *invoking* this
function; the runner itself is queue-agnostic.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from datetime import UTC, datetime
from time import perf_counter as _perf_counter

import httpx
from sqlalchemy.ext.asyncio import async_sessionmaker
from sqlmodel.ext.asyncio.session import AsyncSession

from sentry_scraper_module.agents.graph import PipelineDeps, run_profile_pipeline
from sentry_scraper_module.agents.state import initial_state
from sentry_scraper_module.api.schemas import ProfileRequest, ProfileResult
from sentry_scraper_module.compliance import (
    check_suppression,
    log_pii_redaction,
    log_suppression_reject,
    redact_pii,
)
from sentry_scraper_module.core.config import Settings
from sentry_scraper_module.core.errors import (
    InternalError,
    ProfilingError,
    SuppressedTargetError,
)
from sentry_scraper_module.core.fingerprint import build_fingerprint
from sentry_scraper_module.core.logging import get_logger
from sentry_scraper_module.core.metrics import (
    JOB_COMPLETED_TOTAL,
    JOB_DURATION_SECONDS,
    PII_REDACTION_TOTAL,
    SUPPRESSION_REJECT_TOTAL,
    time_stage,
)
from sentry_scraper_module.persistence.models import JobStatus
from sentry_scraper_module.persistence.repository import (
    get_job_or_raise,
    mark_done,
    mark_failed,
    mark_running,
    update_stage,
)
from sentry_scraper_module.providers.browser import BrowserProvider, StubBrowser
from sentry_scraper_module.providers.embeddings import EmbeddingProvider
from sentry_scraper_module.providers.llm import LLMProvider
from sentry_scraper_module.providers.proxy import MockProxy, ProxyProvider
from sentry_scraper_module.providers.serp import SerpProvider

logger = get_logger(__name__)


@dataclass
class RunDeps:
    """Per-run external dependencies. Built fresh for each job.

    `proxy` and `browser` default to mock implementations so callers
    that don't need anti-bot infrastructure (tests, the in-process
    queue without proxy/browser creds) keep working with no changes.
    """

    http_client: httpx.AsyncClient
    serp: SerpProvider
    llm: LLMProvider
    embeddings: EmbeddingProvider
    proxy: ProxyProvider | None = None
    browser: BrowserProvider | None = None
    settings: Settings | None = None


# Factories yield `RunDeps` from an async context manager so resources
# (notably the HTTP client) are released as soon as the job ends.
DepsContextFactory = Callable[[], AbstractAsyncContextManager[RunDeps]]


def _now() -> datetime:
    return datetime.now(UTC)


async def execute_job(
    job_id: uuid.UUID,
    *,
    session_factory: async_sessionmaker[AsyncSession],
    deps_factory: DepsContextFactory,
) -> None:
    """Run one job end-to-end. Idempotent on terminal states.

    Persistence boundaries:
    - `mark_running` flips status before any pipeline work.
    - Each pipeline stage emits a `update_stage` row via the LangGraph
      `stage_callback`.
    - On success, `mark_done` writes the serialized `ProfileResult`.
    - On `ProfilingError`, `mark_failed` records the typed error body.
    - On unexpected exceptions, we wrap them in `InternalError` so the
      stored `error` row is the same shape the API surfaces.
    """

    log = logger.bind(job_id=str(job_id))
    started_at_monotonic = _perf_counter()

    # 1. Load + transition to running.
    async with session_factory() as session:
        job = await get_job_or_raise(session, job_id)
        if job.status in {JobStatus.done, JobStatus.failed, JobStatus.cancelled}:
            log.info("worker_job_already_terminal", status=str(job.status))
            return
        tenant_id = job.tenant_id
        request = ProfileRequest.model_validate(job.request)
        await mark_running(session, job_id, now=_now())

    log.info("worker_job_started", target=request.target_name)

    # 2. Stage callback persists `stage` after each node and records its
    # wall-clock latency in the per-stage histogram. Phase 5 wiring.
    async def stage_callback(stage: str) -> None:
        with time_stage(stage):
            async with session_factory() as cb_session:
                await update_stage(cb_session, job_id, stage=stage)

    # 3. Build dependencies, drive the graph, persist outcome. We split
    # "produce result" from "persist done" so that a post-success cleanup
    # error (e.g. inside the deps context manager exit) cannot demote a
    # successful job to `failed`.
    result: ProfileResult | None = None
    error_body: dict[str, object] | None = None
    try:
        async with deps_factory() as deps:
            # Mint one residential session per (tenant, job). When no
            # ProxyProvider is configured we fall back to MockProxy so
            # the session_id (and the derived fingerprint) is still
            # deterministic for the run.
            proxy = deps.proxy or MockProxy()
            proxy_session = proxy.session(tenant_id=tenant_id, job_id=job_id)
            fingerprint = build_fingerprint(proxy_session.session_id)
            browser = deps.browser or StubBrowser(client=deps.http_client)

            pipeline_deps = PipelineDeps(
                http_client=deps.http_client,
                serp=deps.serp,
                llm=deps.llm,
                embeddings=deps.embeddings,
                stage_callback=stage_callback,
                browser=browser,
                proxy_session=proxy_session,
                fingerprint=fingerprint,
                settings=deps.settings,
            )
            final = await run_profile_pipeline(
                initial_state(request),
                deps=pipeline_deps,
            )

        profile = final["profile"]
        metadata = final["metadata"]
        if profile is None or metadata is None:
            raise InternalError("Pipeline finished without a profile/metadata.")

        # Defense-in-depth: re-check suppression after extraction in case
        # the target was added to the list mid-flight. If matched, drop
        # the result entirely (don't even persist a redacted form) so
        # nothing about the target leaks downstream.
        async with session_factory() as compliance_session:
            post_suppression = await check_suppression(compliance_session, request)
            if post_suppression.suppressed:
                SUPPRESSION_REJECT_TOTAL.labels(stage="post_extract").inc()
                await log_suppression_reject(
                    compliance_session,
                    tenant_id=tenant_id,
                    target_name=request.target_name,
                    company_name=request.company_name,
                    stage="post_extract",
                )
                raise SuppressedTargetError(
                    "Target was suppressed during extraction; result discarded.",
                    details={
                        "target_name": request.target_name,
                        "company_name": request.company_name,
                    },
                )

            cleaned_profile, redactions = redact_pii(profile)
            if redactions:
                for redaction in redactions:
                    PII_REDACTION_TOTAL.labels(category=redaction.category).inc()
                await log_pii_redaction(
                    compliance_session,
                    tenant_id=tenant_id,
                    job_id=job_id,
                    redactions=redactions,
                )
        result = ProfileResult(profile=cleaned_profile, metadata=metadata)

    except ProfilingError as exc:
        log.warning("worker_job_failed", code=exc.code, message=exc.message)
        error_body = exc.to_body().model_dump(mode="json")
    except Exception as exc:
        # Wrap unknown errors so the stored error body shape stays uniform.
        log.exception("worker_job_crashed", error_type=type(exc).__name__)
        wrapped = InternalError(f"Unhandled worker error: {exc}")
        error_body = wrapped.to_body().model_dump(mode="json")

    elapsed = _perf_counter() - started_at_monotonic

    if result is not None:
        async with session_factory() as session:
            await mark_done(
                session,
                job_id,
                result=result.model_dump(mode="json"),
                now=_now(),
            )
        JOB_COMPLETED_TOTAL.labels(status="done").inc()
        JOB_DURATION_SECONDS.labels(status="done").observe(elapsed)
        log.info(
            "worker_job_done",
            confidence=result.metadata.confidence_score,
            sources=len(result.metadata.sources_used),
        )
        return

    assert error_body is not None  # mutually exclusive with `result`
    async with session_factory() as session:
        await mark_failed(session, job_id, error=error_body, now=_now())
    JOB_COMPLETED_TOTAL.labels(status="failed").inc()
    JOB_DURATION_SECONDS.labels(status="failed").observe(elapsed)


__all__ = ["RunDeps", "execute_job"]
