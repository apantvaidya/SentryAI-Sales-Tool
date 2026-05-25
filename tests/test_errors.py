"""Tests for the typed error hierarchy and the FastAPI exception handler."""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

from sentry_scraper_module.api.main import create_app
from sentry_scraper_module.core.errors import (
    ExtractionFailedError,
    InsufficientSourcesError,
    InvalidRequestError,
    ProfilingError,
    SuppressedTargetError,
    UpstreamBlockedError,
    UpstreamTimeoutError,
)


def _client_raising(exc: ProfilingError) -> TestClient:
    app = create_app()

    @app.get("/__test_raise")
    async def _raise() -> dict[str, Any]:
        raise exc

    return TestClient(app, raise_server_exceptions=False)


def test_invalid_request_maps_to_400() -> None:
    client = _client_raising(InvalidRequestError("bad payload"))
    response = client.get("/__test_raise")
    assert response.status_code == 400
    body = response.json()["error"]
    assert body["code"] == "INVALID_REQUEST"
    assert body["message"] == "bad payload"
    assert body["retryable"] is False
    assert body["details"] == {}


def test_suppressed_maps_to_451() -> None:
    client = _client_raising(SuppressedTargetError("opt-out"))
    response = client.get("/__test_raise")
    assert response.status_code == 451
    assert response.json()["error"]["code"] == "SUPPRESSED"


def test_insufficient_sources_carries_stage_and_details() -> None:
    exc = InsufficientSourcesError(
        "nothing usable",
        stage="distill",
        details={"distilled_count": 0, "fetched_count": 2},
    )
    client = _client_raising(exc)
    response = client.get("/__test_raise")
    assert response.status_code == 422
    body = response.json()["error"]
    assert body["code"] == "INSUFFICIENT_SOURCES"
    assert body["stage"] == "distill"
    assert body["retryable"] is True
    assert body["details"] == {"distilled_count": 0, "fetched_count": 2}


def test_upstream_blocked_is_retryable_502() -> None:
    response = _client_raising(UpstreamBlockedError("WAF")).get("/__test_raise")
    assert response.status_code == 502
    body = response.json()["error"]
    assert body["code"] == "UPSTREAM_BLOCKED"
    assert body["retryable"] is True


def test_upstream_timeout_is_504() -> None:
    response = _client_raising(UpstreamTimeoutError("slow")).get("/__test_raise")
    assert response.status_code == 504
    assert response.json()["error"]["code"] == "UPSTREAM_TIMEOUT"


def test_extraction_failed_is_502() -> None:
    response = _client_raising(ExtractionFailedError("schema mismatch")).get("/__test_raise")
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "EXTRACTION_FAILED"


def test_unhandled_exception_returns_internal_envelope() -> None:
    app = create_app()

    @app.get("/__test_unhandled")
    async def _raise() -> dict[str, Any]:
        raise RuntimeError("boom")

    client = TestClient(app, raise_server_exceptions=False)
    response = client.get("/__test_unhandled")
    assert response.status_code == 500
    body = response.json()["error"]
    assert body["code"] == "INTERNAL"
    assert body["retryable"] is False
