"""Smoke tests for the Phase 0 API skeleton."""

from __future__ import annotations

from fastapi.testclient import TestClient

from sentry_scraper_module import __version__
from sentry_scraper_module.api.main import create_app
from sentry_scraper_module.core.config import Settings


def test_healthz_returns_ok() -> None:
    client = TestClient(create_app())
    response = client.get("/healthz")
    assert response.status_code == 200
    body = response.json()
    assert body == {"ok": True, "version": __version__, "env": "dev"}


def test_healthz_reflects_custom_env() -> None:
    settings = Settings(app_env="staging", log_level="WARNING", log_format="json")
    client = TestClient(create_app(settings))
    body = client.get("/healthz").json()
    assert body["env"] == "staging"


def test_openapi_advertises_version() -> None:
    client = TestClient(create_app())
    schema = client.get("/openapi.json").json()
    assert schema["info"]["title"] == "SentryScraperModule"
    assert schema["info"]["version"] == __version__
