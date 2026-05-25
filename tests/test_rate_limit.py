"""Tests for `core/rate_limit.py`. Phase 5.

Focus: token-bucket admission semantics for `InMemoryRateLimiter` +
selector behaviour for `build_rate_limiter`. `RedisRateLimiter` is
exercised at construction; the live Redis path is gated.
"""

from __future__ import annotations

import asyncio
import uuid

import pytest

from sentry_scraper_module.core.rate_limit import (
    InMemoryRateLimiter,
    NoopRateLimiter,
    RedisRateLimiter,
    build_rate_limiter,
)


async def test_noop_admits_everything() -> None:
    limiter = NoopRateLimiter()
    tenant = uuid.uuid4()
    for _ in range(1000):
        assert await limiter.acquire(tenant) is True
    await limiter.close()


async def test_in_memory_admits_up_to_burst_then_rejects() -> None:
    """Default burst = 2 * per_minute. Bucket starts full."""
    limiter = InMemoryRateLimiter(per_minute=60, burst=3)
    tenant = uuid.uuid4()

    # First 3 requests admitted (burst capacity).
    for _ in range(3):
        assert await limiter.acquire(tenant) is True
    # 4th rejected — tokens exhausted, refill rate too slow to refund mid-test.
    assert await limiter.acquire(tenant) is False

    await limiter.close()


async def test_in_memory_buckets_are_per_tenant() -> None:
    """Tenant A using its quota does NOT exhaust tenant B's bucket."""
    limiter = InMemoryRateLimiter(per_minute=60, burst=2)
    a = uuid.uuid4()
    b = uuid.uuid4()

    for _ in range(2):
        assert await limiter.acquire(a) is True
    assert await limiter.acquire(a) is False
    # B's bucket is untouched.
    assert await limiter.acquire(b) is True

    await limiter.close()


async def test_in_memory_refills_over_time() -> None:
    """Tokens regenerate at `per_minute / 60` per second.

    With per_minute=600 (10/sec) and burst=2, after exhausting we should
    earn a new token in ~100ms.
    """
    limiter = InMemoryRateLimiter(per_minute=600, burst=2)
    tenant = uuid.uuid4()
    assert await limiter.acquire(tenant) is True
    assert await limiter.acquire(tenant) is True
    assert await limiter.acquire(tenant) is False

    # Wait long enough to earn back at least one token.
    await asyncio.sleep(0.15)
    assert await limiter.acquire(tenant) is True

    await limiter.close()


async def test_in_memory_default_burst_is_double_per_minute() -> None:
    """`burst=0` is sentinel for 'use 2x per_minute'."""
    limiter = InMemoryRateLimiter(per_minute=10, burst=0)
    tenant = uuid.uuid4()

    # Capacity = 20.
    for _ in range(20):
        assert await limiter.acquire(tenant) is True
    assert await limiter.acquire(tenant) is False


def test_in_memory_rejects_zero_per_minute() -> None:
    """The contract is explicit: rate=0 means 'use NoopRateLimiter'."""
    with pytest.raises(ValueError, match="per_minute must be > 0"):
        InMemoryRateLimiter(per_minute=0, burst=10)


def test_redis_rejects_zero_per_minute() -> None:
    """Same guard for the Redis adapter — fail loudly at construction."""
    with pytest.raises(ValueError, match="per_minute must be > 0"):
        RedisRateLimiter("redis://localhost:6379/0", per_minute=0, burst=10)


def test_build_returns_noop_when_disabled() -> None:
    limiter = build_rate_limiter(redis_url=None, per_minute=0, burst=0)
    assert isinstance(limiter, NoopRateLimiter)


def test_build_returns_in_memory_when_no_redis() -> None:
    limiter = build_rate_limiter(redis_url=None, per_minute=10, burst=20)
    assert isinstance(limiter, InMemoryRateLimiter)


def test_build_returns_redis_when_url_set() -> None:
    limiter = build_rate_limiter(
        redis_url="redis://localhost:6379/0",
        per_minute=10,
        burst=20,
    )
    assert isinstance(limiter, RedisRateLimiter)
