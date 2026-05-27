"""Per-tenant token-bucket rate limiter.

Phase 5. Two adapters mirror `core/cache.py`:

- `InMemoryRateLimiter` — single-process, lock-protected token bucket
  per tenant. Used by tests and single-machine dev.
- `RedisRateLimiter` — Lua-script-backed atomic bucket. Sound across
  multiple API replicas; required for production deploys with > 1 Fly
  machine in the `api` process group.

Both expose `acquire(tenant_id) -> bool`. A return of `False` means the
caller should reject the request with 429.

Configuration lives on `Settings`:
- `rate_limit_per_minute` — refill rate (tokens added per 60s).
- `rate_limit_burst` — bucket capacity. Defaults to `2 *
  rate_limit_per_minute` if left at 0.

`rate_limit_per_minute=0` returns a `NoopRateLimiter` that always
admits — that's the test default and the documented "off" switch.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass
from typing import Protocol

# Lua: refill the bucket then attempt to take one token. Returns 1 if
# admitted, 0 if rate-limited. Atomic across replicas.
_REDIS_LUA = """
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_per_sec = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])

local tokens
local last
local data = redis.call('HMGET', key, 'tokens', 'ts')
if data[1] == false then
    tokens = capacity
    last = now
else
    tokens = tonumber(data[1])
    last = tonumber(data[2])
    local elapsed = math.max(0, now - last)
    tokens = math.min(capacity, tokens + elapsed * refill_per_sec)
end

local allowed = 0
if tokens >= 1 then
    tokens = tokens - 1
    allowed = 1
end

redis.call('HMSET', key, 'tokens', tokens, 'ts', now)
redis.call('EXPIRE', key, ttl)
return allowed
"""


class RateLimiter(Protocol):
    """Async token-bucket interface."""

    async def acquire(self, tenant_id: uuid.UUID) -> bool: ...

    async def close(self) -> None: ...


class NoopRateLimiter:
    """Always admits. Used when the limiter is disabled (rate_limit_per_minute=0)."""

    async def acquire(self, tenant_id: uuid.UUID) -> bool:
        return True

    async def close(self) -> None:
        return None


@dataclass
class _Bucket:
    tokens: float
    last_refill: float


class InMemoryRateLimiter:
    """Single-process token bucket. Sound for one API replica only."""

    def __init__(self, *, per_minute: int, burst: int) -> None:
        if per_minute <= 0:
            raise ValueError("per_minute must be > 0; use NoopRateLimiter to disable.")
        self._capacity = float(burst if burst > 0 else per_minute * 2)
        self._refill_per_sec = per_minute / 60.0
        self._buckets: dict[uuid.UUID, _Bucket] = {}
        self._lock = asyncio.Lock()

    async def acquire(self, tenant_id: uuid.UUID) -> bool:
        now = time.monotonic()
        async with self._lock:
            bucket = self._buckets.get(tenant_id)
            if bucket is None:
                bucket = _Bucket(tokens=self._capacity, last_refill=now)
                self._buckets[tenant_id] = bucket
            else:
                elapsed = max(0.0, now - bucket.last_refill)
                bucket.tokens = min(self._capacity, bucket.tokens + elapsed * self._refill_per_sec)
                bucket.last_refill = now
            if bucket.tokens >= 1.0:
                bucket.tokens -= 1.0
                return True
            return False

    async def close(self) -> None:
        async with self._lock:
            self._buckets.clear()


class RedisRateLimiter:
    """Redis-backed atomic token bucket. Use this in any deployment with
    more than one API replica."""

    def __init__(
        self,
        url: str,
        *,
        per_minute: int,
        burst: int,
        key_prefix: str = "ratelimit:tenant:",
    ) -> None:
        if per_minute <= 0:
            raise ValueError("per_minute must be > 0; use NoopRateLimiter to disable.")
        from redis.asyncio import Redis, from_url

        # `redis.asyncio.from_url` is untyped in the stub package.
        self._client: Redis = from_url(url, decode_responses=True)  # type: ignore[no-untyped-call]
        self._capacity = float(burst if burst > 0 else per_minute * 2)
        self._refill_per_sec = per_minute / 60.0
        self._prefix = key_prefix
        # Cache the SHA so subsequent calls use EVALSHA for free.
        self._script = self._client.register_script(_REDIS_LUA)

    async def acquire(self, tenant_id: uuid.UUID) -> bool:
        # TTL: keep the bucket alive long enough that an idle tenant's
        # state doesn't expire mid-burst, but doesn't grow unbounded.
        ttl = max(60, int(self._capacity / self._refill_per_sec) + 60)
        result = await self._script(
            keys=[f"{self._prefix}{tenant_id}"],
            args=[self._capacity, self._refill_per_sec, time.time(), ttl],
        )
        return int(result) == 1

    async def close(self) -> None:
        await self._client.aclose()


def build_rate_limiter(
    *,
    redis_url: str | None,
    per_minute: int,
    burst: int,
) -> RateLimiter:
    """Pick the right limiter for the deployment.

    `per_minute=0` → `NoopRateLimiter` (admits everything).
    `redis_url` set → `RedisRateLimiter`.
    Else → `InMemoryRateLimiter`.
    """
    if per_minute <= 0:
        return NoopRateLimiter()
    if redis_url:
        return RedisRateLimiter(redis_url, per_minute=per_minute, burst=burst)
    return InMemoryRateLimiter(per_minute=per_minute, burst=burst)


__all__ = [
    "InMemoryRateLimiter",
    "NoopRateLimiter",
    "RateLimiter",
    "RedisRateLimiter",
    "build_rate_limiter",
]
