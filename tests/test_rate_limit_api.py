"""HTTP-level rate-limit integration. Phase 5.

The unit tests in `test_rate_limit.py` cover the bucket math; this
file proves the FastAPI dependency wiring rejects the (burst+1)-th
POST with the canonical `RATE_LIMITED` envelope.

Uses an inert no-op queue so we don't need to thread real providers
through the lifespan — the rate-limit check fires *before* the queue
dispatch, so the pipeline never runs.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator

import httpx
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport

from sentry_scraper_module.api.main import create_app
from sentry_scraper_module.api.queue import InProcessQueue
from sentry_scraper_module.core.config import Settings


def _noop_queue_factory(app: FastAPI, settings: Settings) -> InProcessQueue:
    """Discard enqueued jobs without running them. Sufficient because the
    rate-limit dependency runs *before* `queue.enqueue` is reached, and
    the rejected paths never enqueue at all."""

    async def _handle(job_id: uuid.UUID) -> None:
        return None

    return InProcessQueue(_handle)


@pytest_asyncio.fixture
async def rate_limited_app() -> AsyncIterator[FastAPI]:
    """App with `rate_limit_per_minute=1, burst=2` so the third POST is rejected."""
    settings = Settings(
        app_env="dev",
        log_level="WARNING",
        log_format="console",
        database_url="sqlite+aiosqlite:///:memory:",
        bootstrap_api_keys="acme:rate-key",
        rate_limit_per_minute=1,
        rate_limit_burst=2,
    )
    application = create_app(settings=settings, queue_factory=_noop_queue_factory)
    async with application.router.lifespan_context(application):
        yield application


@pytest_asyncio.fixture
async def client(rate_limited_app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = ASGITransport(app=rate_limited_app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def test_third_post_returns_429_with_rate_limited_envelope(
    client: httpx.AsyncClient,
) -> None:
    headers = {"X-API-Key": "rate-key"}
    payload = {"target_name": "Jane Smith"}

    # Burst capacity = 2 → first two admitted.
    for _ in range(2):
        resp = await client.post("/v1/profiles", json=payload, headers=headers)
        assert resp.status_code == 202

    # Third request exhausts the bucket.
    rejected = await client.post("/v1/profiles", json=payload, headers=headers)
    assert rejected.status_code == 429
    body = rejected.json()
    assert body["error"]["code"] == "RATE_LIMITED"
    assert body["error"]["retryable"] is True


async def test_unauthenticated_request_skips_rate_limit(
    client: httpx.AsyncClient,
) -> None:
    """Auth runs *before* the rate-limit dep, so a 401 doesn't drain a token."""
    payload = {"target_name": "Jane Smith"}

    # 5 unauthenticated POSTs — none should consume bucket capacity.
    for _ in range(5):
        resp = await client.post("/v1/profiles", json=payload)
        assert resp.status_code == 401

    # The bucket is still at full capacity (2): an authed pair should pass.
    headers = {"X-API-Key": "rate-key"}
    for _ in range(2):
        resp = await client.post("/v1/profiles", json=payload, headers=headers)
        assert resp.status_code == 202
