"""Tests for the HTML → Markdown distillation stage."""

from __future__ import annotations

from sentry_scraper_module.agents.distiller import MIN_WORDS, distill


def test_distill_linkedin_fixture(fixture_html: dict[str, str]) -> None:
    page = distill(
        fixture_html["linkedin_profile"],
        url="https://linkedin.com/in/jane-smith",
    )
    assert page is not None
    assert "Jane Smith" in page.markdown
    assert "Acme Corp" in page.markdown
    assert page.word_count >= MIN_WORDS
    assert page.url == "https://linkedin.com/in/jane-smith"


def test_distill_company_about_fixture(fixture_html: dict[str, str]) -> None:
    page = distill(
        fixture_html["company_about"],
        url="https://acme.example/about",
    )
    assert page is not None
    assert "Acme" in page.markdown
    assert page.word_count >= MIN_WORDS


def test_distill_news_fixture(fixture_html: dict[str, str]) -> None:
    page = distill(
        fixture_html["news_article"],
        url="https://techcrunch.com/article",
    )
    assert page is not None
    assert "Jane Smith" in page.markdown or "Smith" in page.markdown
    assert page.word_count >= MIN_WORDS


def test_distill_challenge_fixture_returns_none(fixture_html: dict[str, str]) -> None:
    page = distill(
        fixture_html["empty_challenge"],
        url="https://example.com/challenge",
    )
    assert page is None


def test_distill_accepts_bytes(fixture_html: dict[str, str]) -> None:
    raw = fixture_html["linkedin_profile"].encode("utf-8")
    page = distill(raw, url="https://linkedin.com/in/jane-smith")
    assert page is not None


def test_distill_empty_string_returns_none() -> None:
    assert distill("", url="https://example.com") is None


def test_distill_too_short_returns_none() -> None:
    html = """<!DOCTYPE html><html><body><p>Hello world.</p></body></html>"""
    assert distill(html, url="https://example.com") is None
