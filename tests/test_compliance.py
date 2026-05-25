"""Unit tests for compliance models, repository helpers, and the
`compliance/` package (suppression, PII filter, audit).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import async_sessionmaker
from sqlmodel.ext.asyncio.session import AsyncSession

from sentry_scraper_module.api.schemas import (
    ContactSection,
    OutreachStrategy,
    PersonalSection,
    ProfessionalSection,
    Profile,
    ProfileRequest,
)
from sentry_scraper_module.compliance import (
    check_suppression,
    log_pii_redaction,
    log_suppression_reject,
    redact_pii,
)
from sentry_scraper_module.compliance.audit import (
    EVENT_PII_REDACTION,
    EVENT_SUPPRESSION_REJECT,
    log_erasure_request,
)
from sentry_scraper_module.persistence.models import (
    AuditEntry,
    Suppression,
    hash_api_key,
    hash_target,
)
from sentry_scraper_module.persistence.repository import (
    add_suppression,
    create_api_key,
    enqueue_job,
    find_tenant_by_api_key,
    is_suppressed,
    list_audit_entries,
    purge_jobs_for_target,
    revoke_api_key,
    upsert_tenant,
)

# ---------------------------------------------------------------------------
# Hashing helpers
# ---------------------------------------------------------------------------


def test_hash_api_key_is_deterministic_and_64_hex() -> None:
    h1 = hash_api_key("secret-xyz")
    h2 = hash_api_key("secret-xyz")
    assert h1 == h2
    assert len(h1) == 64
    assert int(h1, 16) >= 0  # is hex


def test_hash_api_key_changes_with_input() -> None:
    assert hash_api_key("a") != hash_api_key("b")


def test_hash_target_is_case_and_whitespace_insensitive() -> None:
    a = hash_target(" Jane Smith ", "Acme Corp")
    b = hash_target("jane smith", " ACME CORP")
    assert a == b


def test_hash_target_none_company_differs_from_empty_string() -> None:
    # Both should normalise to the same value: empty string after strip.
    a = hash_target("jane", None)
    b = hash_target("jane", "")
    assert a == b


# ---------------------------------------------------------------------------
# API key CRUD
# ---------------------------------------------------------------------------


async def test_create_api_key_stores_hash_not_plaintext(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as session:
        tenant = await upsert_tenant(session, slug="acme")
        key = await create_api_key(session, tenant_id=tenant.id, plaintext="plain")

    assert key.key_hash == hash_api_key("plain")
    assert key.key_hash != "plain"


async def test_find_tenant_by_api_key_resolves_active_key(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as session:
        tenant = await upsert_tenant(session, slug="acme")
        await create_api_key(session, tenant_id=tenant.id, plaintext="plain")

    async with session_factory() as session:
        resolved = await find_tenant_by_api_key(session, plaintext="plain")
    assert resolved is not None
    assert resolved.slug == "acme"


async def test_find_tenant_by_api_key_returns_none_for_unknown_key(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as session:
        resolved = await find_tenant_by_api_key(session, plaintext="nope")
    assert resolved is None


async def test_revoked_key_is_ignored(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as session:
        tenant = await upsert_tenant(session, slug="acme")
        key = await create_api_key(session, tenant_id=tenant.id, plaintext="plain")
        await revoke_api_key(session, api_key_id=key.id, now=datetime.now(UTC))

    async with session_factory() as session:
        resolved = await find_tenant_by_api_key(session, plaintext="plain")
    assert resolved is None


# ---------------------------------------------------------------------------
# Suppression
# ---------------------------------------------------------------------------


async def test_add_suppression_is_idempotent(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as session:
        first = await add_suppression(session, target_name="Jane Smith", company_name="Acme")
        second = await add_suppression(session, target_name="Jane Smith", company_name="Acme")
    assert isinstance(first, Suppression)
    assert first.id == second.id


async def test_is_suppressed_matches_canonical_form(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as session:
        await add_suppression(session, target_name="Jane Smith", company_name="Acme")
        # Case + whitespace variations all hit the same hash.
        assert await is_suppressed(session, target_name="jane smith", company_name=" ACME ")
        # A different person doesn't.
        assert not await is_suppressed(session, target_name="John Doe", company_name="Acme")


async def test_check_suppression_returns_dataclass(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as session:
        await add_suppression(session, target_name="Jane Smith", company_name="Acme")
        result = await check_suppression(
            session,
            ProfileRequest(target_name="Jane Smith", company_name="Acme"),
        )
    assert result.suppressed is True


async def test_purge_jobs_for_target_drops_matching_rows(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as session:
        tenant = await upsert_tenant(session, slug="acme")
        await enqueue_job(
            session,
            tenant_id=tenant.id,
            request=ProfileRequest(target_name="Jane Smith", company_name="Acme"),
        )
        await enqueue_job(
            session,
            tenant_id=tenant.id,
            request=ProfileRequest(target_name="John Doe", company_name="Acme"),
        )
        await enqueue_job(  # duplicate of the first
            session,
            tenant_id=tenant.id,
            request=ProfileRequest(target_name="Jane Smith", company_name="Acme"),
        )

    async with session_factory() as session:
        purged = await purge_jobs_for_target(session, target_name="Jane Smith", company_name="Acme")
    assert purged == 2


# ---------------------------------------------------------------------------
# PII filter
# ---------------------------------------------------------------------------


def _profile_with(**kwargs: object) -> Profile:
    """Helper: build a Profile with `Section(field=...)` overrides."""
    return Profile(
        personal=PersonalSection(**(kwargs.get("personal") or {})),  # type: ignore[arg-type]
        professional=ProfessionalSection(**(kwargs.get("professional") or {})),  # type: ignore[arg-type]
        contact=ContactSection(**(kwargs.get("contact") or {})),  # type: ignore[arg-type]
        outreach_strategy=OutreachStrategy(**(kwargs.get("outreach_strategy") or {})),  # type: ignore[arg-type]
    )


def test_redact_pii_clean_profile_passes_through_unchanged() -> None:
    clean = _profile_with(
        personal={"name": "Jane Smith", "interests": ["hiking", "open source"]},
        professional={"title": "VP Engineering", "company": "Acme"},
    )
    redacted, hits = redact_pii(clean)
    assert hits == []
    assert redacted == clean


def test_redact_pii_strips_health_terms_in_scalar() -> None:
    dirty = _profile_with(
        professional={
            "title": "VP Engineering",
            "cost_metrics": "Manages $5M budget; recovering from cancer treatment.",
        }
    )
    redacted, hits = redact_pii(dirty)
    assert any(h.category == "health" for h in hits)
    assert "cancer" not in redacted.professional.cost_metrics.lower()
    assert "[redacted:health]" in redacted.professional.cost_metrics


def test_redact_pii_drops_list_items_with_family_terms() -> None:
    dirty = _profile_with(
        outreach_strategy={
            "pain_points": [
                "Lacks DevEx tooling",
                "Recently divorced, possibly distracted",
            ]
        }
    )
    redacted, hits = redact_pii(dirty)
    assert any(h.category == "family" for h in hits)
    # Drops contaminated items entirely.
    assert redacted.outreach_strategy.pain_points == ["Lacks DevEx tooling"]


def test_redact_pii_catches_ssn_pattern_in_contact() -> None:
    dirty = _profile_with(contact={"emails": ["jane@example.com", "SSN: 123-45-6789"]})
    redacted, hits = redact_pii(dirty)
    assert any(h.category == "government_id" for h in hits)
    assert redacted.contact.emails == ["jane@example.com"]


def test_redact_pii_reports_dotted_field_paths() -> None:
    dirty = _profile_with(personal={"interests": ["catholic charity volunteer", "cycling"]})
    _, hits = redact_pii(dirty)
    assert any(h.field == "personal.interests[0]" for h in hits)


# ---------------------------------------------------------------------------
# Audit log helpers
# ---------------------------------------------------------------------------


async def test_log_pii_redaction_writes_audit_row(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as session:
        tenant = await upsert_tenant(session, slug="acme")
        job_id = uuid.uuid4()
        dirty = _profile_with(
            professional={"cost_metrics": "Manages $5M budget; treatment ongoing."}
        )
        _, redactions = redact_pii(dirty)
        await log_pii_redaction(
            session,
            tenant_id=tenant.id,
            job_id=job_id,
            redactions=redactions,
        )

    async with session_factory() as session:
        rows = await list_audit_entries(session, event_type=EVENT_PII_REDACTION)
    assert len(rows) == 1
    entry = rows[0]
    assert isinstance(entry, AuditEntry)
    assert entry.payload["count"] == len(redactions)
    assert entry.tenant_id == tenant.id
    assert entry.job_id == job_id


async def test_log_pii_redaction_no_op_when_empty(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as session:
        tenant = await upsert_tenant(session, slug="acme")
        result = await log_pii_redaction(
            session,
            tenant_id=tenant.id,
            job_id=None,
            redactions=[],
        )
    assert result is None


async def test_log_suppression_reject_records_stage_payload(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as session:
        tenant = await upsert_tenant(session, slug="acme")
        await log_suppression_reject(
            session,
            tenant_id=tenant.id,
            target_name="Jane",
            company_name="Acme",
            stage="accept",
        )

    async with session_factory() as session:
        rows = await list_audit_entries(session, event_type=EVENT_SUPPRESSION_REJECT)
    assert len(rows) == 1
    assert rows[0].payload["stage"] == "accept"


async def test_log_erasure_request_carries_purge_count(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as session:
        await log_erasure_request(
            session,
            tenant_id=None,
            target_name="Jane",
            company_name="Acme",
            email=None,
            purged_job_count=3,
        )
    async with session_factory() as session:
        rows = await list_audit_entries(session, event_type="erasure_request")
    assert rows[0].payload["purged_job_count"] == 3
