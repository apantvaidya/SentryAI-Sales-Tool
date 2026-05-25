"""Static + headless fetchers and the challenge-detection heuristic.

Phase 3 plumbs `Fingerprint` and `ProxySession` through the static path
and routes the headless path through a `BrowserProvider`. The defaults
keep the Phase 2 behaviour: if you call `fetch_static(url, client=...)`
with no fingerprint or proxy, you get a plain httpx GET with a
reasonable desktop UA.
"""

from __future__ import annotations

import asyncio
from collections.abc import Iterable, Sequence

import httpx

from sentry_scraper_module.agents.types import FetchedPage
from sentry_scraper_module.core.fingerprint import Fingerprint, build_fingerprint
from sentry_scraper_module.providers.proxy import ProxySession

DEFAULT_TIMEOUT_S = 10.0
DEFAULT_MAX_BYTES = 2_000_000

# Fallback session/fingerprint used when callers don't supply their own
# (tests, the Phase 2 in-process queue without proxy creds, etc.).
_FALLBACK_SESSION = ProxySession(session_id="default", proxy_url=None)
_FALLBACK_FINGERPRINT = build_fingerprint(_FALLBACK_SESSION.session_id)

# Backwards-compat: a few places import `DEFAULT_USER_AGENT` directly.
DEFAULT_USER_AGENT = _FALLBACK_FINGERPRINT.headers["User-Agent"]

# Substrings that strongly suggest the response is a bot-challenge or
# JavaScript-redirect placeholder rather than usable content.
_CHALLENGE_MARKERS: tuple[str, ...] = (
    "cf-mitigated",
    "just a moment",
    "checking your browser",
    "enable javascript",
    "captcha-delivery.com",
    "px-captcha",
)


async def fetch_static(
    url: str,
    *,
    client: httpx.AsyncClient,
    fingerprint: Fingerprint | None = None,
    session: ProxySession | None = None,
    timeout_s: float = DEFAULT_TIMEOUT_S,
    max_bytes: int = DEFAULT_MAX_BYTES,
) -> FetchedPage:
    """Fetch `url` with `client`, optionally through a proxy + fingerprint.

    Errors and timeouts are returned as `FetchedPage` rows with status
    `0` / `599` instead of raising — the graph treats fetch failures as
    escalations or candidates to drop, not as pipeline-killers.

    `fingerprint` controls the header set (UA, sec-ch-ua, Accept-*).
    `session` controls outbound proxy routing; when its `proxy_url` is
    `None` (the default mock case), httpx fetches directly.
    """
    fp = fingerprint or _FALLBACK_FINGERPRINT
    sess = session or _FALLBACK_SESSION
    headers = fp.for_url(url)

    # httpx 0.27 accepts a per-request `proxy=` only on the client ctor.
    # When a proxy is configured we need a dedicated client so this fetch
    # doesn't accidentally inherit the shared client's connection pool.
    try:
        if sess.proxy_url:
            async with httpx.AsyncClient(
                proxy=sess.proxy_url,
                timeout=timeout_s,
            ) as proxied:
                response = await proxied.get(
                    url,
                    headers=headers,
                    timeout=timeout_s,
                    follow_redirects=True,
                )
        else:
            response = await client.get(
                url,
                headers=headers,
                timeout=timeout_s,
                follow_redirects=True,
            )
    except httpx.TimeoutException:
        return FetchedPage(url=url, status=599, body="", fetched_via="static", bytes_in=0)
    except httpx.HTTPError:
        return FetchedPage(url=url, status=0, body="", fetched_via="static", bytes_in=0)

    body = response.text
    if max_bytes > 0 and len(body) > max_bytes:
        body = body[:max_bytes]
    return FetchedPage(
        url=str(response.url),
        status=response.status_code,
        body=body,
        fetched_via="static",
        bytes_in=len(body),
    )


async def fetch_static_many(
    urls: Sequence[str],
    *,
    client: httpx.AsyncClient,
    fingerprint: Fingerprint | None = None,
    session: ProxySession | None = None,
    timeout_s: float = DEFAULT_TIMEOUT_S,
    concurrency: int = 4,
) -> list[FetchedPage]:
    """Fetch many URLs concurrently with a bounded semaphore."""
    sem = asyncio.Semaphore(concurrency)

    async def _one(url: str) -> FetchedPage:
        async with sem:
            return await fetch_static(
                url,
                client=client,
                fingerprint=fingerprint,
                session=session,
                timeout_s=timeout_s,
            )

    return list(await asyncio.gather(*(_one(u) for u in urls)))


def detect_challenge(page: FetchedPage) -> bool:
    """Return True iff `page` looks like a bot-challenge / block response."""
    if page.status in (0, 401, 403, 429, 503, 599):
        return True
    body_lower = page.body.lower()
    return any(marker in body_lower for marker in _CHALLENGE_MARKERS)


def needs_escalation(pages: Iterable[FetchedPage]) -> bool:
    """True if any static page in `pages` needs the headless fallback."""
    return any(detect_challenge(p) for p in pages if p.fetched_via == "static")


__all__ = [
    "DEFAULT_TIMEOUT_S",
    "DEFAULT_USER_AGENT",
    "detect_challenge",
    "fetch_static",
    "fetch_static_many",
    "needs_escalation",
]
