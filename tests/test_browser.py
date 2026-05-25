"""Unit tests for `providers.browser`.

`BrowserlessProvider` and `LocalPlaywrightProvider` are never invoked
against a live network here — we drive them through `httpx.MockTransport`
or assert on the URL/payload they would emit. The `StubBrowser` path is
covered indirectly through `test_graph.py::test_pipeline_escalates_...`
but we add a focused unit test here too.
"""

from __future__ import annotations

from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from sentry_scraper_module.core.fingerprint import build_fingerprint
from sentry_scraper_module.providers.browser import (
    BrowserlessProvider,
    StubBrowser,
)
from sentry_scraper_module.providers.proxy import ProxySession


def _session(proxy_url: str | None = None) -> ProxySession:
    return ProxySession(session_id="sess-test", proxy_url=proxy_url)


# ---------------------------------------------------------------------------
# StubBrowser
# ---------------------------------------------------------------------------


async def test_stub_browser_returns_fetched_via_headless() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, html="<html><body>rendered</body></html>")

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        browser = StubBrowser(client=client)
        page = await browser.render(
            "https://example.test/x",
            session=_session(),
            fingerprint=build_fingerprint("seed"),
        )

    assert page.fetched_via == "headless"
    assert page.status == 200
    assert "rendered" in page.body


async def test_stub_browser_forwards_fingerprint_headers() -> None:
    captured: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["user_agent"] = request.headers.get("user-agent", "")
        captured["referer"] = request.headers.get("referer", "")
        return httpx.Response(200, html="<html>ok</html>")

    fp = build_fingerprint("seed-headless")
    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        browser = StubBrowser(client=client)
        await browser.render(
            "https://example.test/x",
            session=_session(),
            fingerprint=fp,
        )

    assert captured["user_agent"] == fp.headers["User-Agent"]
    assert captured["referer"]


async def test_stub_browser_returns_zero_status_on_transport_error() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("dropped")

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        page = await StubBrowser(client=client).render(
            "https://example.test/x",
            session=_session(),
            fingerprint=build_fingerprint("seed"),
        )

    assert page.status == 0
    assert page.fetched_via == "headless"


# ---------------------------------------------------------------------------
# BrowserlessProvider
# ---------------------------------------------------------------------------


def test_browserless_rejects_empty_token() -> None:
    with pytest.raises(ValueError):
        BrowserlessProvider(token="")


async def test_browserless_posts_to_content_endpoint_with_stealth_flags() -> None:
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["url"] = str(request.url)
        captured["json"] = httpx._utils.to_str(request.content)
        return httpx.Response(200, html="<html><body>browserless</body></html>")

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        browser = BrowserlessProvider(token="brwsr-token", client=client)
        page = await browser.render(
            "https://example.test/x",
            session=_session("http://u:p@gate.smartproxy.com:7000"),
            fingerprint=build_fingerprint("seed"),
        )

    assert page.status == 200
    assert "browserless" in page.body
    assert page.fetched_via == "headless"

    # The URL must be /content with the documented flags + the token.
    assert captured["method"] == "POST"
    url = urlparse(str(captured["url"]))
    assert url.path == "/content"
    qs = parse_qs(url.query)
    assert qs["token"] == ["brwsr-token"]
    assert qs["stealth"] == ["true"]
    assert qs["humanize"] == ["true"]
    assert qs["blockAds"] == ["true"]
    # Proxy URL should be forwarded so rendered traffic shares the IP.
    assert qs["proxy"] == ["http://u:p@gate.smartproxy.com:7000"]


async def test_browserless_omits_proxy_param_when_session_has_no_proxy() -> None:
    captured_url: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured_url["url"] = str(request.url)
        return httpx.Response(200, html="<html>ok</html>")

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        browser = BrowserlessProvider(token="t", client=client)
        await browser.render(
            "https://example.test/x",
            session=_session(None),
            fingerprint=build_fingerprint("seed"),
        )

    qs = parse_qs(urlparse(captured_url["url"]).query)
    assert "proxy" not in qs


async def test_browserless_returns_599_on_timeout() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("too slow")

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        page = await BrowserlessProvider(token="t", client=client).render(
            "https://example.test/x",
            session=_session(),
            fingerprint=build_fingerprint("seed"),
        )

    assert page.status == 599
    assert page.fetched_via == "headless"


async def test_browserless_returns_zero_on_http_error() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("dropped")

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        page = await BrowserlessProvider(token="t", client=client).render(
            "https://example.test/x",
            session=_session(),
            fingerprint=build_fingerprint("seed"),
        )

    assert page.status == 0
    assert page.fetched_via == "headless"
