from __future__ import annotations

import json
from urllib import request
from urllib.parse import urlparse

import httpx

from .config import settings
from .schemas import Lead, LinkedInActivity, ResearchQueries, SearchResult

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
LINKEDIN_PRIORITY_TERMS = (
    "loss prevention",
    "asset protection",
    "organized retail crime",
    "orc",
    "physical security",
    "security",
    "shrink",
    "safety",
    "investigation",
    "compliance",
    "operations",
)


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


def _linkedin_activity_priority(activity: LinkedInActivity) -> tuple[int, int, int]:
    text = f"{activity.title or ''} {activity.text}".lower()
    keyword_rank = 0 if any(term in text for term in LINKEDIN_PRIORITY_TERMS) else 1
    url = (activity.url or "").lower()
    post_rank = 0 if any(part in url for part in ("/posts/", "/feed/update/", "/pulse/")) else 1
    length_rank = 0 if len(activity.text) >= 160 else 1
    return keyword_rank, post_rank, length_rank


def fetch_linkedin_activity_via_exa(lead: Lead, max_items: int = 5) -> list[LinkedInActivity]:
    """Return a list of LinkedIn activity/profile snippets for the lead, or [] if unavailable."""
    if not settings.exa_api_key:
        return []

    query_parts = [f'"{lead.name}"', lead.company, lead.role, "site:linkedin.com"]
    if lead.linkedin:
        query_parts.insert(0, f'"{lead.linkedin}"')
    query = " ".join(part for part in query_parts if part)
    payload = {
        "query": query,
        "type": "neural",
        "numResults": max_items * 2,
        "includeDomains": ["linkedin.com"],
        "contents": {"text": {"maxCharacters": 1200}},
    }
    encoded = json.dumps(payload).encode("utf-8")
    req = request.Request(
        settings.exa_api_url,
        data=encoded,
        headers={"Content-Type": "application/json", "x-api-key": settings.exa_api_key},
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=settings.exa_timeout_seconds) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception:
        return []

    activities: list[LinkedInActivity] = []
    seen_urls: set[str] = set()
    for result in data.get("results", []):
        text = (result.get("text") or "").strip()
        url = result.get("url")
        if not text:
            continue
        if url and url in seen_urls:
            continue
        if url:
            seen_urls.add(url)
        activities.append(
            LinkedInActivity(
                url=url,
                title=result.get("title"),
                text=text,
            )
        )
    activities.sort(key=_linkedin_activity_priority)
    return activities[:max_items]


def run_searches(
    queries: ResearchQueries,
    max_results: int = 5,
    include_raw_content: bool = False,
) -> list[SearchResult]:
    import sys

    ordered_queries = (
        list(queries.company_context_queries)
        + list(queries.professional_interest_queries)
    )

    deduped: dict[str, SearchResult] = {}
    for query in ordered_queries:
        try:
            for result in search_tavily(
                query=query,
                max_results=max_results,
                include_raw_content=include_raw_content,
            ):
                deduped.setdefault(result.url, result)
        except SearchError as exc:
            print(f"[warn] Tavily search skipped: {exc}", file=sys.stderr)

    return sorted(deduped.values(), key=_result_priority)
