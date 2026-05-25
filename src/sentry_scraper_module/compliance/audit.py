"""Thin helpers over `persistence.repository.record_audit_entry`.

Each helper is one well-named function so callers don't have to invent
event-type strings or worry about payload shape. The actual append is
delegated; this module just standardises the schema.
"""

from __future__ import annotations

import uuid

from sqlmodel.ext.asyncio.session import AsyncSession

from sentry_scraper_module.compliance.pii_filter import Redaction
from sentry_scraper_module.persistence.models import AuditEntry
from sentry_scraper_module.persistence.repository import record_audit_entry

EVENT_PII_REDACTION = "pii_redaction"
EVENT_SUPPRESSION_REJECT = "suppression_reject"
EVENT_ERASURE_REQUEST = "erasure_request"


async def log_pii_redaction(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID | None,
    job_id: uuid.UUID | None,
    redactions: list[Redaction],
) -> AuditEntry | None:
    """Emit one audit row summarising the redactions applied to a job.

    Returns `None` when `redactions` is empty so callers can blindly
    invoke this after every pipeline run without producing noise.
    """
    if not redactions:
        return None
    payload = {
        "count": len(redactions),
        "items": [
            {
                "field": r.field,
                "category": r.category,
                "matched_pattern": r.matched_pattern,
            }
            for r in redactions
        ],
    }
    return await record_audit_entry(
        session,
        event_type=EVENT_PII_REDACTION,
        payload=payload,
        tenant_id=tenant_id,
        job_id=job_id,
    )


async def log_suppression_reject(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID | None,
    target_name: str,
    company_name: str | None,
    stage: str,
) -> AuditEntry:
    """`stage` is `"accept"` for the POST-time check and `"post_extract"`
    for the defense-in-depth pass — useful when triaging audit logs."""
    return await record_audit_entry(
        session,
        event_type=EVENT_SUPPRESSION_REJECT,
        payload={
            "target_name": target_name,
            "company_name": company_name,
            "stage": stage,
        },
        tenant_id=tenant_id,
    )


async def log_erasure_request(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID | None,
    target_name: str | None,
    company_name: str | None,
    email: str | None,
    purged_job_count: int,
) -> AuditEntry:
    return await record_audit_entry(
        session,
        event_type=EVENT_ERASURE_REQUEST,
        payload={
            "target_name": target_name,
            "company_name": company_name,
            "email": email,
            "purged_job_count": purged_job_count,
        },
        tenant_id=tenant_id,
    )


__all__ = [
    "EVENT_ERASURE_REQUEST",
    "EVENT_PII_REDACTION",
    "EVENT_SUPPRESSION_REJECT",
    "log_erasure_request",
    "log_pii_redaction",
    "log_suppression_reject",
]
