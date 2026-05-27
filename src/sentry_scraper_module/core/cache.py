"""Async key/value cache with TTLs.

Phase 5. Two adapters: `InMemoryCache` (always available, used for
tests + zero-redis dev) and `RedisCache` (production). Both expose the
same `Cache` Protocol so the rest of the codebase doesn't care which
backend is wired in.

Values are stored as `str` — callers serialize to JSON themselves. This
keeps the adapter dependency-free and makes Redis interop trivial.

TTLs are seconds; `0` means "no expiry" for `InMemoryCache` (matches
Redis's `SETEX 0` semantics) but `RedisCache` requires a positive TTL,
so the helper functions here always pass a real number from
`Settings.cache_*_ttl_seconds`.
"""

from __future__ import annotations

import asyncio
import time
from typing import Protocol


class Cache(Protocol):
    """Minimal async cache interface."""

    async def get(self, key: str) -> str | None: ...

    async def set(self, key: str, value: str, *, ttl_seconds: int) -> None: ...

    async def delete(self, key: str) -> None: ...

    async def close(self) -> None: ...


class InMemoryCache:
    """In-process cache. Used by tests and as the fallback when Redis
    isn't configured.

    Entries are evicted lazily on read; we accept the bounded staleness
    so we don't pay for a sweeper task. The cache is asyncio-safe via a
    single mutex (writes are short).
    """

    def __init__(self) -> None:
        self._store: dict[str, tuple[str, float]] = {}
        self._lock = asyncio.Lock()

    async def get(self, key: str) -> str | None:
        async with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            value, expires_at = entry
            if expires_at and expires_at <= time.monotonic():
                self._store.pop(key, None)
                return None
            return value

    async def set(self, key: str, value: str, *, ttl_seconds: int) -> None:
        expires_at = time.monotonic() + ttl_seconds if ttl_seconds > 0 else 0.0
        async with self._lock:
            self._store[key] = (value, expires_at)

    async def delete(self, key: str) -> None:
        async with self._lock:
            self._store.pop(key, None)

    async def close(self) -> None:
        async with self._lock:
            self._store.clear()


class RedisCache:
    """Redis-backed cache. Lazy-imports `redis.asyncio` so the dep is
    only required when the adapter is actually constructed."""

    def __init__(self, url: str) -> None:
        # Lazy import: `redis` is in core deps but the import path is
        # heavy enough that we only want to pay for it when used.
        from redis.asyncio import Redis, from_url

        self._url = url
        # `redis.asyncio.from_url` is untyped in the stub package; the
        # decoded Redis client we wrap is fully typed below.
        self._client: Redis = from_url(url, decode_responses=True)  # type: ignore[no-untyped-call]

    async def get(self, key: str) -> str | None:
        value = await self._client.get(key)
        # `redis.asyncio` returns Any with decode_responses=True; narrow it.
        if value is None:
            return None
        return str(value)

    async def set(self, key: str, value: str, *, ttl_seconds: int) -> None:
        # Redis rejects ex=0; clamp to a sane minimum so the contract
        # stays uniform with `InMemoryCache`.
        ttl = max(1, ttl_seconds)
        await self._client.set(key, value, ex=ttl)

    async def delete(self, key: str) -> None:
        await self._client.delete(key)

    async def close(self) -> None:
        await self._client.aclose()


def build_cache(redis_url: str | None) -> Cache:
    """Pick `RedisCache` when a URL is provided, else `InMemoryCache`.

    A URL of `redis://localhost:6379/0` (the default) is treated as a
    real Redis attempt. Callers that want to force the in-memory path
    in dev should set `REDIS_URL=` (empty) explicitly.
    """
    if redis_url:
        return RedisCache(redis_url)
    return InMemoryCache()


__all__ = [
    "Cache",
    "InMemoryCache",
    "RedisCache",
    "build_cache",
]
