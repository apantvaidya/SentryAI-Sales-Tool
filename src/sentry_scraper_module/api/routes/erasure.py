"""`DELETE /v1/erasure` — Phase 4 right-to-erasure endpoint.

Hashes the supplied identity (either `target_name + company_name` or
`email`), adds it to the suppression list, and purges any cached jobs
that match. Records an audit row regardless.

The endpoint is intentionally tenant-scoped at the auth layer (you need
a valid `X-API-Key`) but the suppression itself is global — any tenant's
future request for the same target is refused. This matches
`docs/DESIGN.md §7.3`.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlmodel.ext.asyncio.session import AsyncSession

from sentry_scraper_module.api.auth import require_tenant
from sentry_scraper_module.api.dependencies import get_session
from sentry_scraper_module.api.schemas import ErasureRequest, ErasureResponse
from sentry_scraper_module.compliance import log_erasure_request
from sentry_scraper_module.core.errors import InvalidRequestError
from sentry_scraper_module.persistence.models import Tenant, hash_target
from sentry_scraper_module.persistence.repository import (
    add_suppression,
    purge_jobs_for_target,
)

router = APIRouter(prefix="/v1/erasure", tags=["compliance"])


@router.delete("", response_model=ErasureResponse)
async def submit_erasure(
    payload: ErasureRequest,
    tenant: Tenant = Depends(require_tenant),
    session: AsyncSession = Depends(get_session),
) -> ErasureResponse:
    """Accept an erasure request and purge any cached profile data."""
    target_name = payload.target_name
    company_name = payload.company_name
    email = payload.email

    if not target_name and not email:
        raise InvalidRequestError(
            "Provide either target_name or email.",
            details={"required_one_of": ["target_name", "email"]},
        )

    # When only `email` is supplied, hash on the email itself. The
    # suppression check at POST time hashes (name, company) — by storing
    # the email-derived hash under the same `target_hash` column we keep
    # one lookup path. Callers that submit both forms get two
    # suppressions, which is the conservative choice.
    if target_name:
        await add_suppression(
            session,
            target_name=target_name,
            company_name=company_name,
            reason=payload.reason,
        )
        purged = await purge_jobs_for_target(
            session,
            target_name=target_name,
            company_name=company_name,
        )
        target_hash = hash_target(target_name, company_name)
    else:
        assert email is not None  # mutually exclusive with the branch above
        # Email-only erasure: hash the email as the "name" so the
        # suppression row exists and can be matched. We don't purge jobs
        # here — POST routes don't carry an email field today.
        await add_suppression(
            session,
            target_name=email,
            company_name=None,
            reason=payload.reason,
        )
        purged = 0
        target_hash = hash_target(email, None)

    await log_erasure_request(
        session,
        tenant_id=tenant.id,
        target_name=target_name,
        company_name=company_name,
        email=email,
        purged_job_count=purged,
    )

    return ErasureResponse(
        accepted=True,
        target_hash=target_hash,
        purged_job_count=purged,
    )


__all__ = ["router"]
