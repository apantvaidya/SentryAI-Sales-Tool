"""FastAPI dependencies wiring app-state singletons into request handlers."""

from __future__ import annotations

from collections.abc import AsyncIterator

from fastapi import Request
from sqlalchemy.ext.asyncio import async_sessionmaker
from sqlmodel.ext.asyncio.session import AsyncSession

from sentry_scraper_module.api.queue import JobQueue
from sentry_scraper_module.core.errors import RateLimitedError
from sentry_scraper_module.core.metrics import RATE_LIMIT_REJECT_TOTAL
from sentry_scraper_module.core.rate_limit import RateLimiter
from sentry_scraper_module.persistence.models import Tenant


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    """Yield a request-scoped async DB session.

    Commits on clean exit, rolls back on error, and always closes. The
    session factory is built once during `lifespan` and stored on
    `app.state`.
    """
    factory: async_sessionmaker[AsyncSession] = request.app.state.session_factory
    session = factory()
    try:
        yield session
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    finally:
        await session.close()


def get_queue(request: Request) -> JobQueue:
    """Return the process-wide `JobQueue` (arq in prod, in-process in tests)."""
    queue: JobQueue = request.app.state.queue
    return queue


def get_rate_limiter(request: Request) -> RateLimiter:
    """Return the process-wide `RateLimiter`. `NoopRateLimiter` when the
    feature is disabled (default in dev / tests)."""
    limiter: RateLimiter = request.app.state.rate_limiter
    return limiter


async def enforce_rate_limit(
    tenant: Tenant,
    limiter: RateLimiter,
) -> Tenant:
    """Run the per-tenant token bucket and surface a 429 on rejection.

    Kept as a plain function (not a `Depends(...)`) so route modules
    can compose it with `require_tenant` in a single dependency without
    pulling auth's session into the rate-limit path.
    """
    admitted = await limiter.acquire(tenant.id)
    if not admitted:
        RATE_LIMIT_REJECT_TOTAL.labels(tenant_slug=tenant.slug).inc()
        raise RateLimitedError("Per-tenant rate limit exceeded.")
    return tenant


__all__ = [
    "enforce_rate_limit",
    "get_queue",
    "get_rate_limiter",
    "get_session",
]
