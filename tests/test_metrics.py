"""Tests for `core/metrics.py` and the `/metrics` endpoint. Phase 5.

We don't assert exact counter values (other tests on the registry
would interfere); we only verify the endpoint responds in the
Prometheus text format and the helpers wire correctly.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import httpx
import pytest
import pytest_asyncio

from sentry_scraper_module.api.main import create_app
from sentry_scraper_module.core.config import Settings
from sentry_scraper_module.core.metrics import (
    JOB_SUBMITTED_TOTAL,
    render_metrics,
    time_stage,
)


def test_render_metrics_returns_prometheus_text() -> None:
    JOB_SUBMITTED_TOTAL.labels(tenant_slug="probe").inc()
    body, content_type = render_metrics()

    assert content_type.startswith("text/plain")
    text = body.decode("utf-8")
    # Prometheus text format always emits HELP/TYPE comments per metric.
    assert "# HELP sentry_jobs_submitted_total" in text
    assert "# TYPE sentry_jobs_submitted_total counter" in text
    # Our probe label was incremented.
    assert 'sentry_jobs_submitted_total{tenant_slug="probe"}' in text


def _stage_observation_count(stage: str) -> float:
    """Read the observation count out of a Histogram by scraping samples.

    `prometheus_client` doesn't expose `_count` publicly; the `+Inf`
    bucket sample is the canonical "total observations" value.
    """
    from sentry_scraper_module.core.metrics import PIPELINE_STAGE_DURATION_SECONDS

    for metric in PIPELINE_STAGE_DURATION_SECONDS.collect():
        for sample in metric.samples:
            if sample.name.endswith("_count") and sample.labels.get("stage") == stage:
                return float(sample.value)
    return 0.0


def test_time_stage_records_observation() -> None:
    """`time_stage` must record into the per-stage histogram on success."""
    before = _stage_observation_count("probe")
    with time_stage("probe"):
        pass
    after = _stage_observation_count("probe")
    assert after == before + 1


def test_time_stage_records_on_exception() -> None:
    """Failures inside the block still get timed (then re-raised)."""
    before = _stage_observation_count("probe-err")
    with pytest.raises(RuntimeError, match="boom"), time_stage("probe-err"):
        raise RuntimeError("boom")
    after = _stage_observation_count("probe-err")
    assert after == before + 1


@pytest_asyncio.fixture
async def metrics_app() -> AsyncIterator[httpx.AsyncClient]:
    settings = Settings(
        app_env="dev",
        log_format="console",
        database_url="sqlite+aiosqlite:///:memory:",
        metrics_enabled=True,
    )
    app = create_app(settings=settings)
    transport = httpx.ASGITransport(app=app)
    async with (
        httpx.AsyncClient(transport=transport, base_url="http://test") as client,
        app.router.lifespan_context(app),
    ):
        yield client


async def test_metrics_endpoint_serves_prometheus_text(
    metrics_app: httpx.AsyncClient,
) -> None:
    response = await metrics_app.get("/metrics")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/plain")
    # The endpoint is unauthenticated by design (Prometheus scrapers
    # don't carry per-tenant API keys); confirm we expose the standard
    # process collector metric set.
    text = response.text
    assert "sentry_jobs_submitted_total" in text


async def test_metrics_endpoint_disabled_returns_404() -> None:
    settings = Settings(
        app_env="dev",
        log_format="console",
        database_url="sqlite+aiosqlite:///:memory:",
        metrics_enabled=False,
    )
    app = create_app(settings=settings)
    transport = httpx.ASGITransport(app=app)
    async with (
        httpx.AsyncClient(transport=transport, base_url="http://test") as client,
        app.router.lifespan_context(app),
    ):
        response = await client.get("/metrics")
    assert response.status_code == 404
