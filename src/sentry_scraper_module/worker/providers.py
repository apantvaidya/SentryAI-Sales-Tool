"""Default `RunDeps` factory for production worker runs.

Picks real providers when their credentials are configured and falls back
to deterministic fakes otherwise. This is the only place that knows about
provider selection, keeping route handlers and the runner provider-agnostic.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from pydantic import BaseModel

from sentry_scraper_module.api.schemas import Profile
from sentry_scraper_module.core.config import Settings
from sentry_scraper_module.providers.browser import (
    BrowserlessProvider,
    BrowserProvider,
    StubBrowser,
)
from sentry_scraper_module.providers.embeddings import default_embeddings
from sentry_scraper_module.providers.llm import FakeLLM, LiteLLMProvider, LLMProvider
from sentry_scraper_module.providers.proxy import (
    MockProxy,
    ProxyProvider,
    SmartproxyProvider,
)
from sentry_scraper_module.providers.serp import FakeSerp, SerperProvider, SerpProvider
from sentry_scraper_module.worker.runner import RunDeps

DEFAULT_HTTP_TIMEOUT_S = 15.0


def _build_serp(settings: Settings) -> SerpProvider:
    if settings.serper_api_key:
        return SerperProvider(api_key=settings.serper_api_key)
    return FakeSerp({})


def _build_llm(settings: Settings) -> LLMProvider:
    if settings.openai_api_key or settings.anthropic_api_key:
        return LiteLLMProvider()
    # No real keys → deterministic empty profile so the pipeline still
    # finishes with structured output. Production deployments must set at
    # least one provider key.
    canned: BaseModel = Profile()
    return FakeLLM(canned)


def _build_proxy(settings: Settings) -> ProxyProvider:
    if settings.smartproxy_username and settings.smartproxy_password:
        return SmartproxyProvider(
            username=settings.smartproxy_username,
            password=settings.smartproxy_password,
        )
    return MockProxy()


def _build_browser(settings: Settings, client: httpx.AsyncClient) -> BrowserProvider:
    if settings.browserless_token:
        return BrowserlessProvider(token=settings.browserless_token, client=client)
    # StubBrowser re-fetches with httpx — fine for dev / tests / no creds.
    return StubBrowser(client=client)


@asynccontextmanager
async def build_run_deps(settings: Settings) -> AsyncIterator[RunDeps]:
    """Yield `RunDeps` with a managed `httpx.AsyncClient`.

    Use as `async with build_run_deps(settings) as deps:` so the HTTP
    client (and its connection pool) is closed deterministically once the
    job finishes.
    """
    async with httpx.AsyncClient(timeout=DEFAULT_HTTP_TIMEOUT_S) as client:
        yield RunDeps(
            http_client=client,
            serp=_build_serp(settings),
            llm=_build_llm(settings),
            embeddings=default_embeddings(),
            proxy=_build_proxy(settings),
            browser=_build_browser(settings, client),
        )


__all__ = ["build_run_deps"]
