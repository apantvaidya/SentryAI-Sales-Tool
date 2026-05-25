"""Unit tests for `InProcessQueue`."""

from __future__ import annotations

import asyncio
import uuid

from sentry_scraper_module.api.queue import InProcessQueue


async def test_inprocess_queue_runs_handler_for_each_enqueue() -> None:
    received: list[uuid.UUID] = []

    async def handler(job_id: uuid.UUID) -> None:
        received.append(job_id)

    queue = InProcessQueue(handler)
    a = uuid.uuid4()
    b = uuid.uuid4()
    await queue.enqueue(a)
    await queue.enqueue(b)
    await queue.wait_idle()
    assert sorted(received) == sorted([a, b])


async def test_inprocess_queue_close_waits_for_pending() -> None:
    started = asyncio.Event()
    finished = asyncio.Event()

    async def handler(_: uuid.UUID) -> None:
        started.set()
        await asyncio.sleep(0.01)
        finished.set()

    queue = InProcessQueue(handler)
    await queue.enqueue(uuid.uuid4())
    await started.wait()
    await queue.close()
    assert finished.is_set()


async def test_inprocess_queue_swallows_handler_exceptions() -> None:
    """A failing job must not break the queue or leak the exception."""
    calls: list[uuid.UUID] = []

    async def handler(job_id: uuid.UUID) -> None:
        calls.append(job_id)
        raise RuntimeError("boom")

    queue = InProcessQueue(handler)
    job_id = uuid.uuid4()
    await queue.enqueue(job_id)
    await queue.wait_idle()
    # Handler ran; the exception was logged but did not propagate.
    assert calls == [job_id]
