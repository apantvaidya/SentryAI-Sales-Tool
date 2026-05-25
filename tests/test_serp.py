"""Tests for the SERP provider abstraction."""

from __future__ import annotations

import httpx
import pytest

from sentry_scraper_module.providers.serp import (
    FakeSerp,
    SerperProvider,
    SerpResult,
)

# ---------------------------------------------------------------------------
# FakeSerp
# ---------------------------------------------------------------------------


async def test_fake_serp_returns_canned_results_and_records_calls() -> None:
    canned = {
        "alpha": [SerpResult(url="https://a.test/", position=1)],
        "beta": [SerpResult(url="https://b.test/", position=2)],
    }
    serp = FakeSerp(canned)

    alpha_results = await serp.search("alpha", num=10)
    beta_results = await serp.search("beta", num=10)
    miss_results = await serp.search("gamma", num=10)

    assert [r.url for r in alpha_results] == ["https://a.test/"]
    assert [r.url for r in beta_results] == ["https://b.test/"]
    assert miss_results == []
    assert serp.calls == ["alpha", "beta", "gamma"]


async def test_fake_serp_respects_num_cap() -> None:
    canned = {
        "q": [SerpResult(url=f"https://x.test/{i}", position=i) for i in range(1, 6)],
    }
    serp = FakeSerp(canned)
    capped = await serp.search("q", num=2)
    assert len(capped) == 2
    assert capped[0].position == 1


# ---------------------------------------------------------------------------
# SerperProvider (httpx.MockTransport — no real network)
# ---------------------------------------------------------------------------


def _ok_handler(payload: dict[str, object]) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.host == "google.serper.dev"
        assert request.headers["X-API-KEY"] == "secret"
        return httpx.Response(200, json=payload)

    return httpx.MockTransport(handler)


async def test_serper_provider_parses_organic_block() -> None:
    transport = _ok_handler(
        {
            "organic": [
                {
                    "link": "https://one.test/",
                    "title": "One",
                    "snippet": "first",
                    "position": 1,
                },
                {
                    "link": "https://two.test/",
                    "title": "Two",
                    "snippet": "second",
                    "position": 2,
                },
            ]
        }
    )
    async with httpx.AsyncClient(transport=transport) as client:
        provider = SerperProvider("secret", client=client)
        results = await provider.search("vp engineering acme")

    assert [r.url for r in results] == ["https://one.test/", "https://two.test/"]
    assert results[0].title == "One"
    assert results[0].snippet == "first"
    assert results[0].position == 1


async def test_serper_provider_skips_malformed_entries() -> None:
    transport = _ok_handler(
        {
            "organic": [
                {"title": "missing-link"},
                {"link": ""},
                {"link": "https://valid.test/", "position": 7},
                "not-a-dict",
            ]
        }
    )
    async with httpx.AsyncClient(transport=transport) as client:
        provider = SerperProvider("secret", client=client)
        results = await provider.search("q")

    assert [r.url for r in results] == ["https://valid.test/"]
    assert results[0].position == 7


async def test_serper_provider_returns_empty_for_unexpected_payload() -> None:
    transport = _ok_handler({"answerBox": {"answer": "42"}})
    async with httpx.AsyncClient(transport=transport) as client:
        provider = SerperProvider("secret", client=client)
        assert await provider.search("q") == []


def test_serper_provider_rejects_blank_api_key() -> None:
    with pytest.raises(ValueError, match="api_key"):
        SerperProvider("")
