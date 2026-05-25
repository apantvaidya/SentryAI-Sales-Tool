"""Headless browser abstraction.

Headless rendering is the second leg of anti-bot defence: when the static
fetcher gets a challenge page, we re-hit the URL through a stealth-
configured Chromium so the response is the post-JS DOM. Three
implementations live here:

- `StubBrowser` — does no rendering. Re-fetches the URL with httpx and
  flips `fetched_via='headless'`. Used in tests and when no browser
  provider is configured. Behaves like the Phase 2 `fetch_headless` stub.
- `BrowserlessProvider` — connects to Browserless.io's hosted Chromium
  over WebSocket with `stealth=true&humanize=true&blockAds=true` in the
  query string. Routes through the same residential proxy as the static
  leg via the `proxy.url` connect param so the IP stays consistent.
- `LocalPlaywrightProvider` — launches Chromium locally. Only meant for
  the gated live test (`BROWSER_PROVIDER=local`); requires the
  `playwright` package + `playwright install chromium` to have been run.

The graph asks for `BrowserProvider.render(url, session, fingerprint)`
and gets a `FetchedPage` back. Everything else is a provider concern.
"""

from __future__ import annotations

from typing import Protocol
from urllib.parse import urlencode

import httpx

from sentry_scraper_module.agents.types import FetchedPage
from sentry_scraper_module.core.fingerprint import Fingerprint
from sentry_scraper_module.providers.proxy import ProxySession

DEFAULT_RENDER_TIMEOUT_S = 20.0


class BrowserProvider(Protocol):
    async def render(
        self,
        url: str,
        *,
        session: ProxySession,
        fingerprint: Fingerprint,
        timeout_s: float = DEFAULT_RENDER_TIMEOUT_S,
    ) -> FetchedPage: ...


# ---------------------------------------------------------------------------
# Stub — default; matches the Phase 2 fetch_headless behaviour.
# ---------------------------------------------------------------------------


class StubBrowser:
    """Re-fetch the URL with httpx and stamp `fetched_via='headless'`.

    Useful when no real browser provider is configured (dev / tests).
    Honours the proxy session if one is set so we still exercise the
    proxy plumbing.
    """

    def __init__(self, *, client: httpx.AsyncClient) -> None:
        self._client = client

    async def render(
        self,
        url: str,
        *,
        session: ProxySession,
        fingerprint: Fingerprint,
        timeout_s: float = DEFAULT_RENDER_TIMEOUT_S,
    ) -> FetchedPage:
        try:
            response = await self._client.get(
                url,
                headers=fingerprint.for_url(url),
                timeout=timeout_s,
                follow_redirects=True,
            )
        except httpx.TimeoutException:
            return FetchedPage(url=url, status=599, body="", fetched_via="headless", bytes_in=0)
        except httpx.HTTPError:
            return FetchedPage(url=url, status=0, body="", fetched_via="headless", bytes_in=0)

        body = response.text
        return FetchedPage(
            url=str(response.url),
            status=response.status_code,
            body=body,
            fetched_via="headless",
            bytes_in=len(body),
        )


# ---------------------------------------------------------------------------
# Browserless — production hosted Chromium over WebSocket.
# ---------------------------------------------------------------------------


class BrowserlessProvider:
    """Connect to Browserless.io and run a navigate + DOM-capture script.

    We use the `/content` REST endpoint rather than the raw WebSocket to
    keep the dependency surface small (no `playwright` package required
    in the API image). The endpoint accepts a URL + render options and
    returns the post-render HTML.

    Connect-string flags:
    - `stealth=true` — Browserless's bundled stealth patches
      (`navigator.webdriver`, etc.).
    - `humanize=true` — random mouse-moves and scroll before capture.
    - `blockAds=true` — drop ad domains to cut latency.
    """

    DEFAULT_BASE_URL = "https://production-sfo.browserless.io"

    def __init__(
        self,
        *,
        token: str,
        base_url: str | None = None,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        if not token:
            raise ValueError("BrowserlessProvider requires a non-empty token")
        self._token = token
        self._base_url = (base_url or self.DEFAULT_BASE_URL).rstrip("/")
        self._client = client

    def _content_url(self, session: ProxySession) -> str:
        # `proxy` lets Browserless route the rendered traffic through the
        # same residential IP we used for the static probe. Omit it when
        # no proxy is configured so we still work in dev.
        params: dict[str, str] = {
            "token": self._token,
            "stealth": "true",
            "humanize": "true",
            "blockAds": "true",
        }
        if session.proxy_url:
            params["proxy"] = session.proxy_url
        return f"{self._base_url}/content?{urlencode(params)}"

    async def render(
        self,
        url: str,
        *,
        session: ProxySession,
        fingerprint: Fingerprint,
        timeout_s: float = DEFAULT_RENDER_TIMEOUT_S,
    ) -> FetchedPage:
        payload = {
            "url": url,
            "gotoOptions": {"waitUntil": "networkidle2", "timeout": int(timeout_s * 1000)},
            "setExtraHTTPHeaders": fingerprint.for_url(url),
            "userAgent": fingerprint.headers.get("User-Agent", ""),
        }

        client = self._client
        owns_client = client is None
        if client is None:
            client = httpx.AsyncClient(timeout=timeout_s)

        try:
            response = await client.post(
                self._content_url(session),
                json=payload,
                timeout=timeout_s,
            )
        except httpx.TimeoutException:
            return FetchedPage(url=url, status=599, body="", fetched_via="headless", bytes_in=0)
        except httpx.HTTPError:
            return FetchedPage(url=url, status=0, body="", fetched_via="headless", bytes_in=0)
        finally:
            if owns_client:
                await client.aclose()

        body = response.text
        return FetchedPage(
            url=url,
            status=response.status_code,
            body=body,
            fetched_via="headless",
            bytes_in=len(body),
        )


# ---------------------------------------------------------------------------
# Local Playwright — gated live test path.
# ---------------------------------------------------------------------------


class LocalPlaywrightProvider:
    """Launch a local Chromium via Playwright. Lazy-imported so the core
    install never pulls Playwright."""

    def __init__(self, *, headless: bool = True) -> None:
        self._headless = headless

    async def render(
        self,
        url: str,
        *,
        session: ProxySession,
        fingerprint: Fingerprint,
        timeout_s: float = DEFAULT_RENDER_TIMEOUT_S,
    ) -> FetchedPage:
        # Lazy import keeps `playwright` out of the import graph unless
        # someone actually opts into local rendering.
        from playwright.async_api import async_playwright  # type: ignore[import-not-found]

        launch_args: dict[str, object] = {"headless": self._headless}
        if session.proxy_url:
            launch_args["proxy"] = {"server": session.proxy_url}

        try:
            async with async_playwright() as pw:
                browser = await pw.chromium.launch(**launch_args)
                try:
                    context = await browser.new_context(
                        user_agent=fingerprint.headers.get("User-Agent"),
                        extra_http_headers=fingerprint.for_url(url),
                    )
                    page = await context.new_page()
                    response = await page.goto(
                        url,
                        timeout=int(timeout_s * 1000),
                        wait_until="networkidle",
                    )
                    body = await page.content()
                    status = response.status if response is not None else 0
                    return FetchedPage(
                        url=url,
                        status=status,
                        body=body,
                        fetched_via="headless",
                        bytes_in=len(body),
                    )
                finally:
                    await browser.close()
        except Exception:
            return FetchedPage(url=url, status=0, body="", fetched_via="headless", bytes_in=0)


__all__ = [
    "DEFAULT_RENDER_TIMEOUT_S",
    "BrowserProvider",
    "BrowserlessProvider",
    "LocalPlaywrightProvider",
    "StubBrowser",
]
