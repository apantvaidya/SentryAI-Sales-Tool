"""End-to-end HTTP tests for `/v1/profiles`.

The full async-with-polling path runs in-process: enqueue → InProcessQueue
fan-out → worker.execute_job → mark_done / mark_failed → poll.

External dependencies are stubbed:

- HTTP traffic is served by `httpx.MockTransport` over fixture HTML.
- SERP is `FakeSerp`, LLM is `FakeLLM`, embeddings are `HashEmbeddings`.

Auth uses `BOOTSTRAP_API_KEYS` so we cover real key resolution and
cross-tenant isolation.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport

from sentry_scraper_module.api.main import create_app
from sentry_scraper_module.api.queue import InProcessQueue
from sentry_scraper_module.api.schemas import (
    PersonalSection,
    ProfessionalSection,
    Profile,
)
from sentry_scraper_module.core.config import Settings
from sentry_scraper_module.providers.embeddings import HashEmbeddings
from sentry_scraper_module.providers.llm import FakeLLM
from sentry_scraper_module.providers.serp import FakeSerp, SerpResult
from sentry_scraper_module.worker.runner import RunDeps, execute_job

FIXTURES_DIR = Path(__file__).parent / "fixtures"
LINKEDIN_URL = "https://linkedin.com/in/jane-smith"
COMPANY_URL = "https://example.com/about"
NEWS_URL = "https://news.example.com/article"


# ---------------------------------------------------------------------------
# Fixtures + helpers
# ---------------------------------------------------------------------------


def _serve_fixtures() -> Callable[[httpx.Request], httpx.Response]:
    bodies = {
        LINKEDIN_URL: (FIXTURES_DIR / "linkedin_profile.html").read_text(),
        COMPANY_URL: (FIXTURES_DIR / "company_about.html").read_text(),
        NEWS_URL: (FIXTURES_DIR / "news_article.html").read_text(),
    }

    def handler(request: httpx.Request) -> httpx.Response:
        body = bodies.get(str(request.url))
        if body is None:
            return httpx.Response(404, content=b"missing")
        return httpx.Response(200, html=body)

    return handler


def _canned_profile() -> Profile:
    return Profile(
        personal=PersonalSection(name="Jane Smith"),
        professional=ProfessionalSection(title="VP of Engineering", company="Acme Corp"),
    )


def _canned_serp() -> FakeSerp:
    """Return canned SERP results for every planner query."""
    canned = [
        SerpResult(url=LINKEDIN_URL, title="LinkedIn — Jane Smith", position=1),
        SerpResult(url=COMPANY_URL, title="Acme — About", position=2),
        SerpResult(url=NEWS_URL, title="News — Jane Smith", position=3),
    ]
    # FakeSerp returns canned for any query that doesn't match exactly. Here
    # we instead seed an empty mapping and override `search` directly so any
    # query gets the same canned set.
    serp = FakeSerp({})

    async def _search(query: str, *, num: int = 10) -> list[SerpResult]:
        serp.calls.append(query)
        return canned[:num]

    serp.search = _search  # type: ignore[method-assign]
    return serp


def _build_test_settings(*, bootstrap: str = "acme:test-api-key") -> Settings:
    return Settings(
        app_env="dev",
        log_level="WARNING",
        log_format="console",
        database_url="sqlite+aiosqlite:///:memory:",
        bootstrap_api_keys=bootstrap,
    )


def _queue_factory_with_canned_deps(
    transport: httpx.MockTransport,
) -> Callable[[FastAPI, Settings], InProcessQueue]:
    """Wire an InProcessQueue whose handler uses fakes + the mock transport."""

    def _factory(app: FastAPI, settings: Settings) -> InProcessQueue:
        @asynccontextmanager
        async def _deps_factory() -> AsyncIterator[RunDeps]:
            async with httpx.AsyncClient(transport=transport) as client:
                yield RunDeps(
                    http_client=client,
                    serp=_canned_serp(),
                    llm=FakeLLM(_canned_profile()),
                    embeddings=HashEmbeddings(dim=64),
                )

        async def _handle(job_id: uuid.UUID) -> None:
            await execute_job(
                job_id,
                session_factory=app.state.session_factory,
                deps_factory=_deps_factory,
            )

        return InProcessQueue(_handle)

    return _factory


@pytest_asyncio.fixture
async def app() -> AsyncIterator[FastAPI]:
    """Build the FastAPI app with stubbed providers and run its lifespan."""
    settings = _build_test_settings()
    transport = httpx.MockTransport(_serve_fixtures())
    application = create_app(
        settings=settings,
        queue_factory=_queue_factory_with_canned_deps(transport),
    )
    async with application.router.lifespan_context(application):
        yield application


@pytest_asyncio.fixture
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def _drain_queue(app: FastAPI) -> None:
    queue: InProcessQueue = app.state.queue
    await queue.wait_idle()


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


async def test_post_without_api_key_is_unauthorized(client: httpx.AsyncClient) -> None:
    response = await client.post("/v1/profiles", json={"target_name": "Jane Smith"})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHORIZED"


async def test_post_with_invalid_api_key_is_unauthorized(client: httpx.AsyncClient) -> None:
    response = await client.post(
        "/v1/profiles",
        json={"target_name": "Jane Smith"},
        headers={"X-API-Key": "wrong-key"},
    )
    assert response.status_code == 401


# ---------------------------------------------------------------------------
# Happy path: POST → drain → GET → done
# ---------------------------------------------------------------------------


async def test_post_then_poll_completes_successfully(
    app: FastAPI,
    client: httpx.AsyncClient,
) -> None:
    headers = {"X-API-Key": "test-api-key"}
    payload = {"target_name": "Jane Smith", "company_name": "Acme Corp"}

    create_resp = await client.post("/v1/profiles", json=payload, headers=headers)
    assert create_resp.status_code == 202
    accepted = create_resp.json()
    assert accepted["status"] == "queued"
    assert accepted["poll_url"].endswith(accepted["job_id"])

    job_id = accepted["job_id"]

    await _drain_queue(app)

    poll_resp = await client.get(f"/v1/profiles/{job_id}", headers=headers)
    assert poll_resp.status_code == 200
    body = poll_resp.json()
    assert body["job_id"] == job_id
    assert body["status"] == "done"
    assert body["error"] is None
    assert body["completed_at"] is not None
    # The canned LLM produced a Profile with Jane Smith.
    assert body["result"]["profile"]["personal"]["name"] == "Jane Smith"
    # Confidence > 0 because at least one source was used.
    assert body["result"]["metadata"]["confidence_score"] > 0.0
    assert body["result"]["metadata"]["sources_used"]


# ---------------------------------------------------------------------------
# Cancellation
# ---------------------------------------------------------------------------


async def test_delete_before_drain_cancels_job(
    app: FastAPI,
    client: httpx.AsyncClient,
) -> None:
    headers = {"X-API-Key": "test-api-key"}

    create_resp = await client.post(
        "/v1/profiles",
        json={"target_name": "Jane Smith"},
        headers=headers,
    )
    job_id = create_resp.json()["job_id"]

    # Cancel before the worker can finish. The in-process queue spawned a
    # task on POST, but it might not have committed `running` yet — the
    # cancel either lands first (status=cancelled) or after (status=done).
    # Either is correct; the API just guarantees terminal state on DELETE.
    delete_resp = await client.delete(f"/v1/profiles/{job_id}", headers=headers)
    assert delete_resp.status_code == 200
    assert delete_resp.json()["status"] in {"cancelled", "done", "running"}

    await _drain_queue(app)

    # Whatever the worker did, the row is now in a terminal state.
    final = await client.get(f"/v1/profiles/{job_id}", headers=headers)
    assert final.json()["status"] in {"cancelled", "done"}


# ---------------------------------------------------------------------------
# Cross-tenant isolation
# ---------------------------------------------------------------------------


async def test_cross_tenant_get_returns_not_found() -> None:
    settings = Settings(
        app_env="dev",
        log_level="WARNING",
        log_format="console",
        database_url="sqlite+aiosqlite:///:memory:",
        bootstrap_api_keys="acme:key-acme,initech:key-initech",
    )
    transport = httpx.MockTransport(_serve_fixtures())
    application = create_app(
        settings=settings,
        queue_factory=_queue_factory_with_canned_deps(transport),
    )

    async with (
        application.router.lifespan_context(application),
        httpx.AsyncClient(
            transport=ASGITransport(app=application),
            base_url="http://test",
        ) as c,
    ):
        create_resp = await c.post(
            "/v1/profiles",
            json={"target_name": "Jane Smith"},
            headers={"X-API-Key": "key-acme"},
        )
        assert create_resp.status_code == 202
        job_id = create_resp.json()["job_id"]

        await application.state.queue.wait_idle()

        # Owner of the job can read it.
        owned = await c.get(f"/v1/profiles/{job_id}", headers={"X-API-Key": "key-acme"})
        assert owned.status_code == 200

        # Another tenant gets `INVALID_REQUEST` (404-ish) — never 403,
        # to avoid leaking job existence.
        foreign = await c.get(
            f"/v1/profiles/{job_id}",
            headers={"X-API-Key": "key-initech"},
        )
        assert foreign.status_code == 400
        assert foreign.json()["error"]["code"] == "INVALID_REQUEST"


# ---------------------------------------------------------------------------
# Unknown job ID
# ---------------------------------------------------------------------------


async def test_get_unknown_job_returns_invalid_request(client: httpx.AsyncClient) -> None:
    headers = {"X-API-Key": "test-api-key"}
    missing = str(uuid.uuid4())
    response = await client.get(f"/v1/profiles/{missing}", headers=headers)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID_REQUEST"
