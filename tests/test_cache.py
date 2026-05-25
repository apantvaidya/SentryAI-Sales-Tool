"""Tests for `core/cache.py`. Phase 5.

Covers `InMemoryCache` end-to-end and the `build_cache` selector.
`RedisCache` is exercised at construction time only; a live Redis
integration test is gated and lives in `tests/external/` (not part of
the default suite).
"""

from __future__ import annotations

import asyncio

import pytest

from sentry_scraper_module.core.cache import (
    InMemoryCache,
    RedisCache,
    build_cache,
)


async def test_in_memory_cache_round_trip() -> None:
    cache = InMemoryCache()
    await cache.set("k1", "value", ttl_seconds=10)

    assert await cache.get("k1") == "value"
    assert await cache.get("missing") is None

    await cache.close()


async def test_in_memory_cache_ttl_expires_lazily() -> None:
    """Entries past their TTL are evicted on the next read."""
    cache = InMemoryCache()
    await cache.set("k", "v", ttl_seconds=1)

    # Immediate read still finds it.
    assert await cache.get("k") == "v"

    # Sleep past TTL. Use real-time sleep — the cache reads `time.monotonic`
    # directly so freezing wall-clock won't help.
    await asyncio.sleep(1.1)
    assert await cache.get("k") is None


async def test_in_memory_cache_zero_ttl_means_no_expiry() -> None:
    """`ttl_seconds=0` matches Redis SETEX-0 semantics: never expires."""
    cache = InMemoryCache()
    await cache.set("k", "v", ttl_seconds=0)

    await asyncio.sleep(0.05)
    assert await cache.get("k") == "v"


async def test_in_memory_cache_delete() -> None:
    cache = InMemoryCache()
    await cache.set("k", "v", ttl_seconds=10)
    await cache.delete("k")
    assert await cache.get("k") is None
    # Deleting a missing key is a no-op, not an error.
    await cache.delete("missing")


async def test_in_memory_cache_overwrite_resets_ttl() -> None:
    cache = InMemoryCache()
    await cache.set("k", "first", ttl_seconds=1)
    await cache.set("k", "second", ttl_seconds=10)

    await asyncio.sleep(1.1)
    # The second write replaced the first AND its short TTL.
    assert await cache.get("k") == "second"


async def test_build_cache_picks_in_memory_when_url_unset() -> None:
    cache = build_cache(redis_url=None)
    assert isinstance(cache, InMemoryCache)
    await cache.close()


async def test_build_cache_picks_in_memory_when_url_empty() -> None:
    """Empty string is falsy and treated as 'no Redis'."""
    cache = build_cache(redis_url="")
    assert isinstance(cache, InMemoryCache)
    await cache.close()


def test_build_cache_picks_redis_when_url_set() -> None:
    """Construction is lazy: building a `RedisCache` does NOT connect."""
    cache = build_cache(redis_url="redis://localhost:6379/0")
    assert isinstance(cache, RedisCache)
    # Defer .close() to the event loop fixture — pytest_asyncio handles it.


async def test_in_memory_cache_concurrent_writes_safe() -> None:
    """The internal lock keeps concurrent writers from clobbering state."""
    cache = InMemoryCache()

    async def writer(idx: int) -> None:
        for i in range(50):
            await cache.set(f"k-{idx}", str(i), ttl_seconds=10)

    await asyncio.gather(*(writer(i) for i in range(5)))

    # Each writer's last write should be visible.
    for idx in range(5):
        assert await cache.get(f"k-{idx}") == "49"


@pytest.mark.parametrize("url", ["redis://localhost:6379/0", "rediss://example:6379"])
def test_redis_cache_construction_does_not_connect(url: str) -> None:
    """Smoke: building the adapter is side-effect-free until first use."""
    cache = RedisCache(url)
    assert cache._url == url
