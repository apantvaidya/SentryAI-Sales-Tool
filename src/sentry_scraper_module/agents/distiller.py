"""Distillation stage — strip boilerplate and convert HTML to clean Markdown.

`trafilatura` does the heavy lifting: heuristic content extraction with
boilerplate / nav / ad removal and a built-in Markdown renderer. We layer
a small policy on top (minimum word count, separate metadata pass) so the
output type is uniform for downstream stages.
"""

from __future__ import annotations

import trafilatura

from sentry_scraper_module.agents.types import DistilledPage

# Pages with fewer than this many words after distillation are treated as
# distillation failures (challenge pages, redirect placeholders, empty
# template shells). The chunker would not be able to do anything useful
# with them and shipping them to the LLM only wastes tokens.
MIN_WORDS = 50


def distill(html: str | bytes, *, url: str) -> DistilledPage | None:
    """Convert raw HTML into a `DistilledPage`, or `None` if unusable.

    Returning `None` (rather than raising) lets the caller batch-distill a
    list of fetched pages and simply drop the failures from the candidate
    set without aborting the whole build.
    """
    if isinstance(html, bytes):
        html = html.decode("utf-8", errors="replace")

    text = trafilatura.extract(
        html,
        output_format="markdown",
        include_links=False,
        include_tables=True,
        favor_recall=True,
    )
    if text is None:
        return None
    text = text.strip()
    if not text:
        return None

    word_count = len(text.split())
    if word_count < MIN_WORDS:
        return None

    title: str | None = None
    metadata = trafilatura.extract_metadata(html)
    if metadata is not None and metadata.title:
        title = metadata.title.strip() or None

    return DistilledPage(
        url=url,
        markdown=text,
        title=title,
        word_count=word_count,
    )


__all__ = ["MIN_WORDS", "distill"]
