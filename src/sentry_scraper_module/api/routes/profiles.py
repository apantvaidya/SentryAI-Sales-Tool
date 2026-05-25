"""`/v1/profiles` routes — async-with-polling job control.

Three endpoints, each isolated to a thin orchestration layer:

- `POST /v1/profiles`   → enqueue a job, return `JobAccepted` (202)
- `GET  /v1/profiles/{job_id}` → return `JobStatusResponse`
- `DELETE /v1/profiles/{job_id}` → idempotent cancel, return `JobStatusResponse`

All three depend on `require_tenant`, so a valid `X-API-Key` resolves
the calling tenant before any DB work runs. Cross-tenant reads are
explicitly blocked: a job_id owned by another tenant returns 404 (not
403) so we don't leak existence.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Request, status
from sqlmodel.ext.asyncio.session import AsyncSession

from sentry_scraper_module.api.auth import require_tenant
from sentry_scraper_module.api.dependencies import (
    enforce_rate_limit,
    get_queue,
    get_rate_limiter,
    get_session,
)
from sentry_scraper_module.api.queue import JobQueue
from sentry_scraper_module.api.schemas import (
    JobAccepted,
    JobError,
    JobStatusResponse,
    ProfileRequest,
    ProfileResult,
)
from sentry_scraper_module.compliance import check_suppression, log_suppression_reject
from sentry_scraper_module.core.errors import InvalidRequestError, SuppressedTargetError
from sentry_scraper_module.core.metrics import (
    JOB_SUBMITTED_TOTAL,
    SUPPRESSION_REJECT_TOTAL,
)
from sentry_scraper_module.core.rate_limit import RateLimiter
from sentry_scraper_module.persistence.models import Job, JobStatus, Tenant
from sentry_scraper_module.persistence.repository import (
    cancel_job,
    enqueue_job,
    get_job,
)

router = APIRouter(prefix="/v1/profiles", tags=["profiles"])


def _to_status_response(job: Job) -> JobStatusResponse:
    """Translate a persisted `Job` row into the wire envelope."""
    result_obj: ProfileResult | None = None
    if job.result is not None:
        result_obj = ProfileResult.model_validate(job.result)

    error_obj: JobError | None = None
    if job.error is not None:
        error_obj = JobError.model_validate(job.error)

    return JobStatusResponse(
        job_id=job.id,
        status=job.status.value,
        stage=job.stage,
        created_at=job.created_at,
        started_at=job.started_at,
        completed_at=job.completed_at,
        expires_at=job.expires_at,
        result=result_obj,
        error=error_obj,
    )


async def _load_owned_job(
    session: AsyncSession,
    job_id: uuid.UUID,
    tenant: Tenant,
) -> Job:
    job = await get_job(session, job_id)
    if job is None or job.tenant_id != tenant.id:
        # Treat cross-tenant access the same as not-found to avoid leaking
        # job existence across tenants.
        raise InvalidRequestError(
            f"Job {job_id} not found.",
            details={"job_id": str(job_id)},
        )
    return job


@router.post("", response_model=JobAccepted, status_code=status.HTTP_202_ACCEPTED)
async def create_profile_job(
    request: Request,
    payload: ProfileRequest,
    tenant: Tenant = Depends(require_tenant),
    session: AsyncSession = Depends(get_session),
    queue: JobQueue = Depends(get_queue),
    limiter: RateLimiter = Depends(get_rate_limiter),
) -> JobAccepted:
    """Enqueue a new profile build for `tenant` and return its job ID.

    Suppressed targets are refused with 451 *before* any external work
    happens. The reject is written to the audit log for compliance.

    The per-tenant rate limiter is checked *after* auth + suppression so
    suppressed-but-rate-limited callers still get the 451 (more useful
    feedback) and so a 429 doesn't leak that the target is on the
    suppression list.
    """
    suppression = await check_suppression(session, payload)
    if suppression.suppressed:
        SUPPRESSION_REJECT_TOTAL.labels(stage="accept").inc()
        await log_suppression_reject(
            session,
            tenant_id=tenant.id,
            target_name=payload.target_name,
            company_name=payload.company_name,
            stage="accept",
        )
        raise SuppressedTargetError(
            "Target is on the suppression list.",
            details={
                "target_name": payload.target_name,
                "company_name": payload.company_name,
            },
        )

    await enforce_rate_limit(tenant, limiter)

    job = await enqueue_job(session, tenant_id=tenant.id, request=payload)
    await queue.enqueue(job.id)
    JOB_SUBMITTED_TOTAL.labels(tenant_slug=tenant.slug).inc()
    return JobAccepted(
        job_id=job.id,
        status="queued",
        poll_url=f"{request.url.path.rstrip('/')}/{job.id}",
    )


@router.get("/{job_id}", response_model=JobStatusResponse)
async def get_profile_job(
    job_id: uuid.UUID,
    tenant: Tenant = Depends(require_tenant),
    session: AsyncSession = Depends(get_session),
) -> JobStatusResponse:
    job = await _load_owned_job(session, job_id, tenant)
    return _to_status_response(job)


@router.delete("/{job_id}", response_model=JobStatusResponse)
async def cancel_profile_job(
    job_id: uuid.UUID,
    tenant: Tenant = Depends(require_tenant),
    session: AsyncSession = Depends(get_session),
) -> JobStatusResponse:
    job = await _load_owned_job(session, job_id, tenant)
    if job.status not in {JobStatus.done, JobStatus.failed, JobStatus.cancelled}:
        job = await cancel_job(session, job.id, now=datetime.now(UTC))
    return _to_status_response(job)


__all__ = ["router"]
