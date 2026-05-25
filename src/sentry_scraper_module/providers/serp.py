"""SERP (search engine results page) provider abstraction.

Production uses `SerperProvider` (Serper.dev's POST /search API). Tests
use `FakeSerp` to return deterministic canned results without hitting the
network.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Protocol

import httpx
from pydantic import BaseModel, ConfigDict

DEFAULT_NUM_RESULTS = 10


class SerpResult(BaseModel):
    """One organic result from a SERP query."""

    model_config = ConfigDict(extra="forbid")

    url: str
    title: str = ""
    snippet: str = ""
    position: int = 0


class SerpProvider(Protocol):
    async def search(
        self,
        query: str,
        *,
        num: int = DEFAULT_NUM_RESULTS,
    ) -> list[SerpResult]: ...


# ---------------------------------------------------------------------------
# Fake provider (test default).
# ---------------------------------------------------------------------------


class FakeSerp:
    """Returns canned `SerpResult` lists keyed by exact-match query string.

    Construct with a mapping `{query_string: [SerpResult, ...]}`. Queries
    that don't match return an empty list.
    """

    def __init__(self, results_by_query: Mapping[str, list[SerpResult]]) -> None:
        self._results = {q: list(results) for q, results in results_by_query.items()}
        self.calls: list[str] = []

    async def search(
        self,
        query: str,
        *,
        num: int = DEFAULT_NUM_RESULTS,
    ) -> list[SerpResult]:
        self.calls.append(query)
        return list(self._results.get(query, []))[:num]


# ---------------------------------------------------------------------------
# Serper.dev adapter (production).
# ---------------------------------------------------------------------------


class SerperProvider:
    """Calls https://google.serper.dev/search."""

    BASE_URL = "https://google.serper.dev/search"

    def __init__(
        self,
        api_key: str,
        *,
        client: httpx.AsyncClient | None = None,
        timeout_s: float = 10.0,
    ) -> None:
        if not api_key:
            raise ValueError("SerperProvider requires a non-empty api_key")
        self._api_key = api_key
        self._client = client
        self._timeout_s = timeout_s

    async def search(
        self,
        query: str,
        *,
        num: int = DEFAULT_NUM_RESULTS,
    ) -> list[SerpResult]:
        payload = {"q": query, "num": num}
        headers = {"X-API-KEY": self._api_key, "Content-Type": "application/json"}

        if self._client is not None:
            response = await self._client.post(
                self.BASE_URL,
                json=payload,
                headers=headers,
                timeout=self._timeout_s,
            )
        else:
            async with httpx.AsyncClient(timeout=self._timeout_s) as client:
                response = await client.post(
                    self.BASE_URL,
                    json=payload,
                    headers=headers,
                )
        response.raise_for_status()
        return _parse_serper_response(response.json())


def _parse_serper_response(payload: Any) -> list[SerpResult]:
    if not isinstance(payload, dict):
        return []
    organic = payload.get("organic", [])
    if not isinstance(organic, list):
        return []
    results: list[SerpResult] = []
    for index, item in enumerate(organic, start=1):
        if not isinstance(item, dict):
            continue
        link = item.get("link")
        if not isinstance(link, str) or not link:
            continue
        results.append(
            SerpResult(
                url=link,
                title=str(item.get("title", "")),
                snippet=str(item.get("snippet", "")),
                position=int(item.get("position", index)),
            )
        )
    return results


__all__ = [
    "DEFAULT_NUM_RESULTS",
    "FakeSerp",
    "SerpProvider",
    "SerpResult",
    "SerperProvider",
]
