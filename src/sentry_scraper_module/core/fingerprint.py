"""Coherent HTTP fingerprint generator.

Generates a header set whose `User-Agent`, `sec-ch-ua*`,
`Accept-Language`, and `Accept` headers are all mutually consistent — a
mismatched UA / Client Hints combo is a strong bot signal on its own.
See `docs/DESIGN.md §6.2`.

Each `(session_id, url)` pair maps to a stable fingerprint so retries
look like the same browser. Two different sessions targeting the same URL
get different fingerprints — that's the whole point.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from urllib.parse import urlparse

# A curated, coherent set of browser profiles. Each tuple is treated as a
# unit: pick one, and every dependent header (sec-ch-ua, platform,
# mobile, Accept) is consistent. Versions are intentionally a few months
# behind the bleeding edge so they're plausible across the install base.
_BROWSER_PROFILES: tuple[dict[str, str], ...] = (
    {
        "name": "chrome-mac",
        "user_agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/127.0.0.0 Safari/537.36"
        ),
        "sec_ch_ua": '"Not)A;Brand";v="99", "Google Chrome";v="127", "Chromium";v="127"',
        "sec_ch_ua_mobile": "?0",
        "sec_ch_ua_platform": '"macOS"',
    },
    {
        "name": "chrome-windows",
        "user_agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/127.0.0.0 Safari/537.36"
        ),
        "sec_ch_ua": '"Not)A;Brand";v="99", "Google Chrome";v="127", "Chromium";v="127"',
        "sec_ch_ua_mobile": "?0",
        "sec_ch_ua_platform": '"Windows"',
    },
    {
        "name": "safari-mac",
        "user_agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/605.1.15 (KHTML, like Gecko) "
            "Version/17.5 Safari/605.1.15"
        ),
        # Safari does not emit Client Hints today.
        "sec_ch_ua": "",
        "sec_ch_ua_mobile": "",
        "sec_ch_ua_platform": "",
    },
    {
        "name": "firefox-windows",
        "user_agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0"
        ),
        # Firefox does not emit Client Hints by default.
        "sec_ch_ua": "",
        "sec_ch_ua_mobile": "",
        "sec_ch_ua_platform": "",
    },
)

_ACCEPT_LANGUAGES: tuple[str, ...] = (
    "en-US,en;q=0.9",
    "en-US,en;q=0.8",
    "en-GB,en-US;q=0.9,en;q=0.8",
)

# Standard Chrome/Safari/Firefox Accept-Encoding. Servers route compression
# on this — keep it realistic.
_ACCEPT_ENCODING = "gzip, deflate, br"

# Top-level Accept differs between resource types; we always fetch HTML.
_ACCEPT_HTML = (
    "text/html,application/xhtml+xml,application/xml;q=0.9,"
    "image/avif,image/webp,image/apng,*/*;q=0.8"
)


@dataclass(frozen=True)
class Fingerprint:
    """One coherent set of request headers + the profile name we sampled."""

    profile_name: str
    headers: dict[str, str] = field(default_factory=dict)

    def for_url(self, url: str) -> dict[str, str]:
        """Return the headers with a per-request `Referer` mixed in.

        We pick a plausible referer based on the target host so it looks
        like the user navigated from a search engine rather than typing
        the URL directly. Headers are returned as a new dict; the
        instance stays frozen.
        """
        return {**self.headers, "Referer": _referer_for(url)}


def build_fingerprint(session_id: str) -> Fingerprint:
    """Sample a coherent browser fingerprint from `session_id`.

    Deterministic in `session_id`: the same session always gets the same
    headers, so multi-page fetches inside one profile build present a
    consistent identity. Two different sessions get independent draws.
    """
    rng = random.Random(session_id)
    profile = rng.choice(_BROWSER_PROFILES)
    accept_language = rng.choice(_ACCEPT_LANGUAGES)

    # Headers are inserted in roughly real-browser order so naive
    # fingerprinters comparing header sequence don't see a Python-ish
    # alphabetical list.
    headers: dict[str, str] = {
        "User-Agent": profile["user_agent"],
        "Accept": _ACCEPT_HTML,
        "Accept-Language": accept_language,
        "Accept-Encoding": _ACCEPT_ENCODING,
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "cross-site",
        "Sec-Fetch-User": "?1",
    }
    if profile["sec_ch_ua"]:
        headers["sec-ch-ua"] = profile["sec_ch_ua"]
        headers["sec-ch-ua-mobile"] = profile["sec_ch_ua_mobile"]
        headers["sec-ch-ua-platform"] = profile["sec_ch_ua_platform"]
    return Fingerprint(profile_name=profile["name"], headers=headers)


def _referer_for(url: str) -> str:
    """Pick a plausible referer for `url`.

    Prefers Google for non-Google targets; otherwise direct
    (empty referer would be suspicious, so fall back to the target
    origin itself, which mimics in-site navigation).
    """
    parsed = urlparse(url)
    host = parsed.netloc.lower()
    if "google" in host:
        return f"{parsed.scheme}://{parsed.netloc}/"
    return "https://www.google.com/"


__all__ = ["Fingerprint", "build_fingerprint"]
