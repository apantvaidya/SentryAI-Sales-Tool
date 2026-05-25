"""Prometheus metrics for the SentryScraperModule API + worker.

Phase 5. We define a small set of named counters + histograms here so
the rest of the codebase imports stable handles instead of touching
`prometheus_client` directly. All metrics live on a private
`CollectorRegistry` so tests can observe + reset them in isolation.

Conventions (per Prometheus naming style):
- Counters end in `_total` and have an `app="sentry_scraper_module"`
  base label.
- Latency is in seconds (Prometheus convention), exposed as a
  histogram with sane bucket boundaries for 1s–60s pipeline runs.
- All metrics are no-ops when `Settings.metrics_enabled=False` — the
  `/metrics` endpoint just isn't mounted, and the `metric_*` helpers
  remain functional but their data is never scraped.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from time import perf_counter

from prometheus_client import (
    CONTENT_TYPE_LATEST,
    CollectorRegistry,
    Counter,
    Histogram,
    generate_latest,
)

# Buckets: profile builds typically resolve in 5–30s. Cap at 120s so we
# can spot stuck jobs without ballooning histogram cardinality.
_LATENCY_BUCKETS = (0.5, 1.0, 2.5, 5.0, 10.0, 20.0, 30.0, 60.0, 120.0)

REGISTRY = CollectorRegistry()

JOB_SUBMITTED_TOTAL = Counter(
    "sentry_jobs_submitted_total",
    "Profile-build jobs accepted by POST /v1/profiles.",
    labelnames=("tenant_slug",),
    registry=REGISTRY,
)

JOB_COMPLETED_TOTAL = Counter(
    "sentry_jobs_completed_total",
    "Profile-build jobs that reached a terminal status.",
    labelnames=("status",),  # done | failed | cancelled
    registry=REGISTRY,
)

JOB_DURATION_SECONDS = Histogram(
    "sentry_job_duration_seconds",
    "Wall-clock latency from job enqueue to terminal status.",
    labelnames=("status",),
    buckets=_LATENCY_BUCKETS,
    registry=REGISTRY,
)

PIPELINE_STAGE_DURATION_SECONDS = Histogram(
    "sentry_pipeline_stage_duration_seconds",
    "Per-LangGraph-node wall-clock latency.",
    labelnames=("stage",),
    buckets=(0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0),
    registry=REGISTRY,
)

SUPPRESSION_REJECT_TOTAL = Counter(
    "sentry_suppression_rejects_total",
    "Profile requests refused because the target is on the suppression list.",
    labelnames=("stage",),  # accept | post_extract
    registry=REGISTRY,
)

PII_REDACTION_TOTAL = Counter(
    "sentry_pii_redactions_total",
    "Number of PII redactions applied to a finished profile.",
    labelnames=("category",),
    registry=REGISTRY,
)

RATE_LIMIT_REJECT_TOTAL = Counter(
    "sentry_rate_limit_rejects_total",
    "API requests rejected with 429 by the per-tenant rate limiter.",
    labelnames=("tenant_slug",),
    registry=REGISTRY,
)


def render_metrics() -> tuple[bytes, str]:
    """Render the registry in the Prometheus text format.

    Returns `(body, content_type)` so the FastAPI route can wire it
    straight into a `Response`.
    """
    return generate_latest(REGISTRY), CONTENT_TYPE_LATEST


@contextmanager
def time_stage(stage: str) -> Iterator[None]:
    """Time a block and record into `PIPELINE_STAGE_DURATION_SECONDS`.

    Used by the worker's stage callback. Failures inside the block are
    propagated; the timing still gets recorded.
    """
    started = perf_counter()
    try:
        yield
    finally:
        PIPELINE_STAGE_DURATION_SECONDS.labels(stage=stage).observe(perf_counter() - started)


__all__ = [
    "JOB_COMPLETED_TOTAL",
    "JOB_DURATION_SECONDS",
    "JOB_SUBMITTED_TOTAL",
    "PII_REDACTION_TOTAL",
    "PIPELINE_STAGE_DURATION_SECONDS",
    "RATE_LIMIT_REJECT_TOTAL",
    "REGISTRY",
    "SUPPRESSION_REJECT_TOTAL",
    "render_metrics",
    "time_stage",
]
