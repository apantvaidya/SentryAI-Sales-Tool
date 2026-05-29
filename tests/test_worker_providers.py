"""Unit tests for `worker.providers.build_run_deps` selection logic.

Asserts that the right concrete provider is picked for each combination
of credentials. Nothing here makes a real network call.
"""

from __future__ import annotations

from sentry_scraper_module.core.config import Settings
from sentry_scraper_module.providers.browser import BrowserlessProvider, StubBrowser
from sentry_scraper_module.providers.llm import FakeLLM, LiteLLMProvider
from sentry_scraper_module.providers.proxy import MockProxy, SmartproxyProvider
from sentry_scraper_module.providers.serp import FakeSerp, SerperProvider
from sentry_scraper_module.worker.providers import build_run_deps


async def test_build_run_deps_uses_fakes_when_no_credentials() -> None:
    settings = Settings(
        serper_api_key=None,
        openai_api_key=None,
        anthropic_api_key=None,
        smartproxy_username=None,
        smartproxy_password=None,
        browserless_token=None,
    )

    async with build_run_deps(settings) as deps:
        assert isinstance(deps.serp, FakeSerp)
        assert isinstance(deps.llm, FakeLLM)
        assert isinstance(deps.proxy, MockProxy)
        assert isinstance(deps.browser, StubBrowser)


async def test_build_run_deps_picks_serper_when_key_set() -> None:
    settings = Settings(serper_api_key="serper-xxx")

    async with build_run_deps(settings) as deps:
        assert isinstance(deps.serp, SerperProvider)


async def test_build_run_deps_picks_litellm_when_any_provider_key_set() -> None:
    settings = Settings(openai_api_key="oai-xxx")

    async with build_run_deps(settings) as deps:
        assert isinstance(deps.llm, LiteLLMProvider)


async def test_build_run_deps_picks_smartproxy_when_both_credentials_set() -> None:
    settings = Settings(
        smartproxy_username="user",
        smartproxy_password="pass",
    )

    async with build_run_deps(settings) as deps:
        assert isinstance(deps.proxy, SmartproxyProvider)


async def test_build_run_deps_falls_back_to_mock_proxy_with_partial_credentials() -> None:
    # Username without password (or vice versa) must NOT silently
    # construct a misconfigured SmartproxyProvider.
    settings = Settings(smartproxy_username="user")
    async with build_run_deps(settings) as deps:
        assert isinstance(deps.proxy, MockProxy)

    settings = Settings(smartproxy_password="pass")
    async with build_run_deps(settings) as deps:
        assert isinstance(deps.proxy, MockProxy)


async def test_build_run_deps_picks_browserless_when_token_set() -> None:
    settings = Settings(browserless_token="brw-xxx")

    async with build_run_deps(settings) as deps:
        assert isinstance(deps.browser, BrowserlessProvider)


async def test_build_run_deps_closes_http_client_after_use() -> None:
    settings = Settings()

    async with build_run_deps(settings) as deps:
        client = deps.http_client
        assert not client.is_closed

    assert client.is_closed
