"""Phase 1 fixture-driven CLI: distill → chunk → extract → confidence → JSON.

Usage:
    python -m sentry_scraper_module.scripts.run_pipeline \\
        --target-name "Jane Smith" \\
        --company-name "Acme Corp" \\
        --fixtures-dir tests/fixtures

The CLI is the demo gate for Phase 1 in `docs/PLAN.md`. It runs the
pipeline against on-disk HTML files and prints a `ProfileResult` JSON to
stdout. By default it uses `FakeLLM` seeded with a canned response so it
needs no API keys; pass `--llm litellm` to route through the real provider
(reads OPENAI_API_KEY / ANTHROPIC_API_KEY from the environment).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Literal

from sentry_scraper_module.agents.chunker import select_relevant_chunks
from sentry_scraper_module.agents.confidence import compute_confidence
from sentry_scraper_module.agents.distiller import distill
from sentry_scraper_module.agents.extractor import extract_profile
from sentry_scraper_module.agents.planner import build_retrieval_queries
from sentry_scraper_module.agents.types import DistilledPage
from sentry_scraper_module.api.schemas import (
    BuildMetadata,
    PersonalSection,
    ProfessionalSection,
    Profile,
    ProfileRequest,
    ProfileResult,
)
from sentry_scraper_module.providers.embeddings import default_embeddings
from sentry_scraper_module.providers.llm import FakeLLM, LiteLLMProvider, LLMProvider

# Convention: fixture filenames map to host names so the resulting profile
# carries plausible source URLs without needing an external manifest.
_DEFAULT_HOSTS = {
    "linkedin_profile": "linkedin.com/in/jane-smith",
    "company_about": "acme.example/about",
    "news_article": "techcrunch.com/2024/acme-restructure",
    "empty_challenge": "example.com/challenge",
}


def _build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="run_pipeline", description=__doc__)
    parser.add_argument("--target-name", required=True)
    parser.add_argument("--company-name", default=None)
    parser.add_argument("--context-goal", default=None)
    parser.add_argument(
        "--mode",
        choices=("surface", "deep"),
        default="surface",
        help=(
            "Retrieval depth. `deep` widens planning/retrieval toward pain points "
            "and initiatives."
        ),
    )
    parser.add_argument(
        "--fixtures-dir",
        type=Path,
        required=True,
        help="Directory containing *.html files to feed the pipeline.",
    )
    parser.add_argument(
        "--llm",
        choices=("fake", "litellm"),
        default="fake",
        help="`fake` uses a canned profile (no network). `litellm` calls the real provider.",
    )
    parser.add_argument(
        "--top-k",
        type=int,
        default=3,
        help="Number of distilled chunks to send to the extractor.",
    )
    return parser


def _resolve_url(stem: str) -> str:
    return f"https://{_DEFAULT_HOSTS.get(stem, f'example.com/{stem}')}"


def _load_pages(fixtures_dir: Path) -> list[DistilledPage]:
    html_files = sorted(fixtures_dir.glob("*.html"))
    if not html_files:
        raise SystemExit(f"No *.html files found under {fixtures_dir}")
    pages: list[DistilledPage] = []
    for path in html_files:
        page = distill(path.read_text(encoding="utf-8"), url=_resolve_url(path.stem))
        if page is not None:
            pages.append(page)
    return pages


def _make_llm(kind: Literal["fake", "litellm"]) -> LLMProvider:
    if kind == "fake":
        canned = Profile(
            personal=PersonalSection(name="Jane Smith"),
            professional=ProfessionalSection(
                title="VP of Engineering",
                company="Acme Corp",
            ),
        )
        return FakeLLM(canned)
    return LiteLLMProvider()


async def run(args: argparse.Namespace) -> ProfileResult:
    pages = _load_pages(args.fixtures_dir)
    if not pages:
        raise SystemExit("All fixtures distilled to empty content; nothing to extract.")

    request = ProfileRequest(
        target_name=args.target_name,
        company_name=args.company_name,
        context_goal=args.context_goal,
        mode=args.mode,
    )
    chunks = select_relevant_chunks(
        pages,
        build_retrieval_queries(request),
        embeddings=default_embeddings(),
        top_k=args.top_k,
    )

    llm = _make_llm(args.llm)
    profile = await extract_profile(request, chunks, llm=llm)

    sources = [page.url for page in pages]
    score, low = compute_confidence(profile, sources)

    return ProfileResult(
        profile=profile,
        metadata=BuildMetadata(
            sources_used=sources,
            confidence_score=score,
            low_confidence=low,
        ),
    )


def main(argv: list[str] | None = None) -> int:
    args = _build_arg_parser().parse_args(argv)
    result = asyncio.run(run(args))
    json.dump(result.model_dump(), sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
