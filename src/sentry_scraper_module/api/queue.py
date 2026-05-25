"""Job-queue abstraction.

The API only needs `enqueue(job_id)`; everything else (worker pool,
retries, dead-letter handling) lives behind the `JobQueue` Protocol so
tests can swap in `InProcessQueue` and the production worker can use
`ArqQueue` without touching route code.
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Awaitable, Callable
from typing import Any, Protocol, runtime_checkable

from sentry_scraper_module.core.logging import get_logger

logger = get_logger(__name__)


@runtime_checkable
class JobQueue(Protocol):
    """Minimal contract every queue backend must satisfy."""

    async def enqueue(self, job_id: uuid.UUID) -> None: ...
    async def close(self) -> None: ...


# ---------------------------------------------------------------------------
# In-process queue — used in tests and the `dev` env so we don't require a
# Redis/arq stack to run the API end-to-end.
# ---------------------------------------------------------------------------


JobHandler = Callable[[uuid.UUID], Awaitable[None]]


class InProcessQueue:
    """Run jobs as background `asyncio.Task`s in the API process.

    Every `enqueue(job_id)` call spawns a task that invokes `handler`. We
    track the tasks so `close()` can await graceful shutdown — important
    for tests that assert on terminal job state.
    """

    def __init__(self, handler: JobHandler) -> None:
        self._handler = handler
        self._tasks: set[asyncio.Task[None]] = set()

    async def enqueue(self, job_id: uuid.UUID) -> None:
        task = asyncio.create_task(self._run(job_id))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _run(self, job_id: uuid.UUID) -> None:
        try:
            await self._handler(job_id)
        except Exception:  # pragma: no cover - handler is expected to log
            logger.exception("inprocess_job_crashed", job_id=str(job_id))

    async def wait_idle(self) -> None:
        """Block until every spawned task has completed (test helper)."""
        if not self._tasks:
            return
        await asyncio.gather(*list(self._tasks), return_exceptions=True)

    async def close(self) -> None:
        await self.wait_idle()


# ---------------------------------------------------------------------------
# arq queue — production backend. We keep the import lazy so the API can
# run without Redis when `JOB_QUEUE_BACKEND=inprocess`.
# ---------------------------------------------------------------------------


class ArqQueue:
    """Thin wrapper around an arq Redis pool that enqueues `run_profile_job`."""

    def __init__(self, redis_pool: Any, *, function_name: str = "run_profile_job") -> None:
        self._redis = redis_pool
        self._function_name = function_name

    async def enqueue(self, job_id: uuid.UUID) -> None:
        await self._redis.enqueue_job(self._function_name, str(job_id))

    async def close(self) -> None:
        # arq's RedisPool exposes `close()` in v0.26+; older versions use
        # `close()` on the underlying connection. We support either via duck-typing.
        close = getattr(self._redis, "close", None)
        if close is None:  # pragma: no cover - defensive
            return
        result = close()
        if asyncio.iscoroutine(result):
            await result


__all__ = [
    "ArqQueue",
    "InProcessQueue",
    "JobHandler",
    "JobQueue",
]
