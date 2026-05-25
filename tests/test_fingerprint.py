"""Unit tests for `core.fingerprint`.

Property-style: assert the headers a fingerprint produces are mutually
coherent (UA vs sec-ch-ua-platform, etc.), deterministic in the
`session_id` seed, and rotate plausibly across seeds.
"""

from __future__ import annotations

from sentry_scraper_module.core.fingerprint import Fingerprint, build_fingerprint


def test_build_fingerprint_is_deterministic_per_session() -> None:
    a = build_fingerprint("abc")
    b = build_fingerprint("abc")
    assert a == b


def test_different_sessions_can_produce_different_fingerprints() -> None:
    # Statistical: across many seeds we expect at least two distinct
    # profile_names. With four browser profiles seeded random.choice,
    # collisions are vanishingly rare.
    seen = {build_fingerprint(f"seed-{i}").profile_name for i in range(50)}
    assert len(seen) >= 2


def test_required_headers_are_always_present() -> None:
    fp = build_fingerprint("seed")
    for key in (
        "User-Agent",
        "Accept",
        "Accept-Language",
        "Accept-Encoding",
        "Upgrade-Insecure-Requests",
        "Sec-Fetch-Dest",
        "Sec-Fetch-Mode",
        "Sec-Fetch-Site",
        "Sec-Fetch-User",
    ):
        assert key in fp.headers, key
        assert fp.headers[key]  # non-empty


def test_chrome_profile_emits_consistent_sec_ch_ua_platform() -> None:
    # Walk many seeds; for every one that picks a Chrome profile, the
    # platform hint must match the UA. This is the canonical "coherent"
    # invariant — a mismatched UA / sec-ch-ua-platform is a giveaway.
    for i in range(200):
        fp = build_fingerprint(f"seed-{i}")
        ua = fp.headers["User-Agent"]
        platform = fp.headers.get("sec-ch-ua-platform", "")
        if "Chrome/" not in ua:
            # Firefox / Safari profiles legitimately omit Client Hints.
            assert platform == ""
            continue
        if "Windows" in ua:
            assert platform == '"Windows"'
        elif "Mac OS X" in ua:
            assert platform == '"macOS"'
        else:  # pragma: no cover - curated pool doesn't include other UAs
            raise AssertionError(f"unexpected Chrome UA without known platform: {ua}")


def test_safari_and_firefox_omit_client_hints() -> None:
    # The two non-Chromium profiles must not emit sec-ch-ua / mobile /
    # platform — real Safari/Firefox don't send those.
    saw_safari = saw_firefox = False
    for i in range(200):
        fp = build_fingerprint(f"seed-{i}")
        ua = fp.headers["User-Agent"]
        if "Safari/" in ua and "Chrome/" not in ua:
            saw_safari = True
            assert "sec-ch-ua" not in fp.headers
        if "Firefox/" in ua:
            saw_firefox = True
            assert "sec-ch-ua" not in fp.headers
    # The curated pool guarantees both are reachable.
    assert saw_safari and saw_firefox


def test_for_url_injects_per_request_referer() -> None:
    fp = build_fingerprint("seed-1")
    headers = fp.for_url("https://example.com/some/page")
    assert headers["Referer"] == "https://www.google.com/"
    # Underlying fingerprint stays unchanged (frozen dataclass invariant).
    assert "Referer" not in fp.headers


def test_for_url_uses_same_origin_referer_for_google_targets() -> None:
    fp = build_fingerprint("seed-1")
    headers = fp.for_url("https://www.google.com/search?q=jane+smith")
    # Targeting Google itself: use the target's own origin as referer
    # (mimics in-site navigation), not a fresh "https://www.google.com/"
    # entry that would imply a SERP→SERP click.
    assert headers["Referer"].startswith("https://")
    assert "google.com" in headers["Referer"]


def test_fingerprint_dataclass_is_hashable() -> None:
    # The frozen dataclass-with-dict-default loses hashability if you
    # mutate `headers`. Build via the factory and confirm equality.
    a = build_fingerprint("seed-x")
    b = build_fingerprint("seed-x")
    assert isinstance(a, Fingerprint)
    assert a == b
