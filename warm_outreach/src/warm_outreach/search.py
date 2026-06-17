from __future__ import annotations

from urllib.parse import urlparse

import httpx

from .config import settings
from .schemas import ResearchQueries, SearchResult

NEWS_DOMAINS = {
    "reuters.com",
    "apnews.com",
    "cnn.com",
    "nytimes.com",
    "wsj.com",
    "usatoday.com",
    "abcnews.go.com",
    "nbcnews.com",
    "foxnews.com",
    "latimes.com",
    "sfchronicle.com",
    "fox5sandiego.com",
    "sandiegouniontribune.com",
    "kusi.com",
    "kvue.com",
    "kxan.com",
    "spectrumlocalnews.com",
}

INDUSTRY_DOMAINS = {
    "securityinfowatch.com",
    "securitymagazine.com",
    "asisonline.org",
    "facilityexecutive.com",
    "ehstoday.com",
    "constructiondive.com",
    "retailwire.com",
}

GOVERNMENT_HINTS = ("police", "sheriff", "cityof", "county", "state", "fbi", "ca.gov")
BLOCKED_DOMAINS = {
    "linkedin.com",
    "facebook.com",
    "instagram.com",
    "youtube.com",
    "reddit.com",
    "tiktok.com",
    "x.com",
    "twitter.com",
}
GENERIC_QUERY_TOKENS = {
    "the",
    "and",
    "for",
    "with",
    "service",
    "centers",
    "construction",
    "operations",
    "physical",
    "locations",
    "sites",
    "facilities",
    "security",
    "crime",
    "data",
    "dashboard",
    "property",
    "theft",
    "burglary",
    "vehicle",
    "after",
    "hours",
    "monitoring",
}


class SearchError(RuntimeError):
    pass


def _domain(url: str) -> str:
    return urlparse(url).netloc.lower()


def _is_blocked_domain(domain: str) -> bool:
    return any(domain == blocked or domain.endswith(f".{blocked}") for blocked in BLOCKED_DOMAINS)


def _query_company_tokens(query: str) -> set[str]:
    tokens = set()
    for token in query.lower().replace("/", " ").split():
        normalized = "".join(ch for ch in token if ch.isalnum())
        if len(normalized) >= 4 and normalized not in GENERIC_QUERY_TOKENS:
            tokens.add(normalized)
    return tokens


def classify_source_type(url: str, query: str) -> tuple[str, str]:
    domain = _domain(url)
    company_tokens = _query_company_tokens(query)

    if domain.endswith(".gov") or any(hint in domain for hint in GOVERNMENT_HINTS):
        return "official_government", "high"

    if any(domain == news or domain.endswith(f".{news}") for news in NEWS_DOMAINS):
        return "reputable_news", "high"

    if any(domain == site or domain.endswith(f".{site}") for site in INDUSTRY_DOMAINS):
        return "industry_source", "medium"

    if company_tokens and any(token in domain.replace("-", "") for token in company_tokens):
        return "official_company", "medium"

    if domain:
        return "general_web", "low"

    return "unknown", "low"


def _result_priority(result: SearchResult) -> tuple[int, int]:
    source_rank = {
        "official_government": 0,
        "reputable_news": 1,
        "official_company": 2,
        "industry_source": 3,
        "general_web": 4,
        "unknown": 5,
    }.get(result.source_type, 5)
    confidence_rank = {"high": 0, "medium": 1, "low": 2}.get(result.confidence, 2)
    return source_rank, confidence_rank


def search_tavily(
    query: str,
    max_results: int = 5,
    include_raw_content: bool = False,
) -> list[SearchResult]:
    if not settings.tavily_api_key:
        raise SearchError("TAVILY_API_KEY is not set.")

    body = {
        "api_key": settings.tavily_api_key,
        "query": query,
        "search_depth": settings.tavily_search_depth,
        "include_answer": False,
        "include_raw_content": include_raw_content,
        "max_results": max_results,
    }

    with httpx.Client(timeout=settings.tavily_timeout_seconds) as client:
        response = client.post("https://api.tavily.com/search", json=body)

    if response.status_code >= 400:
        raise SearchError(f"Tavily request failed ({response.status_code}): {response.text}")

    payload = response.json()
    results = payload.get("results", [])
    search_results: list[SearchResult] = []

    for item in results:
        url = item.get("url")
        title = item.get("title")
        if not url or not title:
            continue
        domain = _domain(url)
        if _is_blocked_domain(domain):
            continue
        source_type, confidence = classify_source_type(url, query)
        search_results.append(
            SearchResult(
                query=query,
                title=title,
                url=url,
                snippet=item.get("content"),
                raw_content=item.get("raw_content"),
                source_type=source_type,
                confidence=confidence,
            )
        )

    return search_results


def run_searches(
    queries: ResearchQueries,
    max_results: int = 5,
    include_raw_content: bool = False,
) -> list[SearchResult]:
    ordered_queries = (
        list(queries.company_context_queries)
        + list(queries.local_crime_queries)
        + list(queries.recent_incident_queries)
        + list(queries.role_specific_risk_queries)
    )

    deduped: dict[str, SearchResult] = {}
    for query in ordered_queries:
        for result in search_tavily(
            query=query,
            max_results=max_results,
            include_raw_content=include_raw_content,
        ):
            deduped.setdefault(result.url, result)

    return sorted(deduped.values(), key=_result_priority)
