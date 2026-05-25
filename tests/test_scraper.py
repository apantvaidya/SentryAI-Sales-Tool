"""Tests for `agents.scraper`.

Network is fully mocked via `httpx.MockTransport` — these tests never hit
the real internet.
"""

from __future__ import annotations

from collections.abc import Callable

import httpx

from sentry_scraper_module.agents.scraper import (
    detect_challenge,
    fetch_static,
    fetch_static_many,
    needs_escalation,
)
from sentry_scraper_module.agents.types import FetchedPage


def _transport_from(
    handler: Callable[[httpx.Request], httpx.Response],
) -> httpx.MockTransport:
    return httpx.MockTransport(handler)


# ---------------------------------------------------------------------------
# fetch_static
# ---------------------------------------------------------------------------


async def test_fetch_static_returns_body_and_status() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, html="<html><body>hello</body></html>")

    async with httpx.AsyncClient(transport=_transport_from(handler)) as client:
        page = await fetch_static("https://x.test/", client=client)

    assert page.status == 200
    assert "hello" in page.body
    assert page.fetched_via == "static"
    assert page.bytes_in > 0


async def test_fetch_static_truncates_oversized_bodies() -> None:
    body = "x" * 10_000

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=body.encode())

    async with httpx.AsyncClient(transport=_transport_from(handler)) as client:
        page = await fetch_static("https://x.test/", client=client, max_bytes=100)

    assert len(page.body) == 100
    assert page.bytes_in == 100


async def test_fetch_static_returns_zero_status_on_transport_error() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("boom")

    async with httpx.AsyncClient(transport=_transport_from(handler)) as client:
        page = await fetch_static("https://x.test/", client=client)

    assert page.status == 0
    assert page.body == ""
    assert page.fetched_via == "static"


async def test_fetch_static_returns_599_on_timeout() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow")

    async with httpx.AsyncClient(transport=_transport_from(handler)) as client:
        page = await fetch_static("https://x.test/", client=client)

    assert page.status == 599
    assert page.fetched_via == "static"


# ---------------------------------------------------------------------------
# fetch_static_many
# ---------------------------------------------------------------------------


async def test_fetch_static_many_returns_one_page_per_url() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=request.url.path.encode())

    urls = [f"https://x.test/{i}" for i in range(5)]
    async with httpx.AsyncClient(transport=_transport_from(handler)) as client:
        pages = await fetch_static_many(urls, client=client, concurrency=2)

    assert len(pages) == len(urls)
    assert {p.body for p in pages} == {f"/{i}" for i in range(5)}


# ---------------------------------------------------------------------------
# detect_challenge / needs_escalation
# ---------------------------------------------------------------------------


def test_detect_challenge_flags_blocked_status_codes() -> None:
    for status in (401, 403, 429, 503, 599, 0):
        page = FetchedPage(url="https://x.test", status=status, body="ok", fetched_via="static")
        assert detect_challenge(page), status


def test_detect_challenge_flags_known_body_markers() -> None:
    page = FetchedPage(
        url="https://x.test",
        status=200,
        body="<html>Just a moment... cf-mitigated</html>",
        fetched_via="static",
    )
    assert detect_challenge(page)


def test_detect_challenge_passes_clean_responses() -> None:
    page = FetchedPage(
        url="https://x.test",
        status=200,
        body="<html><body>plain content</body></html>",
        fetched_via="static",
    )
    assert not detect_challenge(page)


def test_needs_escalation_only_considers_static_pages() -> None:
    static_blocked = FetchedPage(url="https://x.test", status=403, body="", fetched_via="static")
    headless_ok = FetchedPage(url="https://x.test", status=200, body="ok", fetched_via="headless")
    assert needs_escalation([static_blocked])
    # If only headless pages are present, we don't need to escalate again.
    assert not needs_escalation([headless_ok])


# ---------------------------------------------------------------------------
# fingerprint + proxy session integration (Phase 3)
# ---------------------------------------------------------------------------


async def test_fetch_static_uses_fingerprint_headers_when_provided() -> None:
    from sentry_scraper_module.core.fingerprint import build_fingerprint

    captured: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["user_agent"] = request.headers.get("user-agent", "")
        captured["accept_language"] = request.headers.get("accept-language", "")
        captured["referer"] = request.headers.get("referer", "")
        return httpx.Response(200, html="<html>ok</html>")

    fp = build_fingerprint("test-session-abc")
    async with httpx.AsyncClient(transport=_transport_from(handler)) as client:
        await fetch_static("https://example.test/page", client=client, fingerprint=fp)

    assert captured["user_agent"] == fp.headers["User-Agent"]
    assert captured["accept_language"] == fp.headers["Accept-Language"]
    # Referer should be filled in per-URL (not hardcoded "").
    assert captured["referer"]


async def test_fetch_static_falls_back_to_default_fingerprint() -> None:
    captured: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["user_agent"] = request.headers.get("user-agent", "")
        return httpx.Response(200, html="<html>ok</html>")

    async with httpx.AsyncClient(transport=_transport_from(handler)) as client:
        await fetch_static("https://example.test/", client=client)

    # Whatever the default fingerprint produces, it should be a plausible
    # browser UA — not empty.
    assert "Mozilla/5.0" in captured["user_agent"]
