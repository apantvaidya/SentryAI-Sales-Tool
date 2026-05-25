"""Extraction stage — single LLM call producing a structured `Profile`.

The system prompt encodes the compliance and grounding rules from
`docs/DESIGN.md §7.4` and §7.2 directly. Combined with the strict JSON
Schema enforced by the LLM provider, this stage is the contract enforcer
for what the API will eventually return.
"""

from __future__ import annotations

from collections.abc import Sequence

from sentry_scraper_module.agents.types import Chunk
from sentry_scraper_module.api.schemas import Profile, ProfileRequest
from sentry_scraper_module.providers.llm import LLMProvider

SYSTEM_PROMPT = """\
You are SentryScraperModule's profile extraction agent.

You will receive distilled excerpts about a target individual scraped from
public B2B sources, together with the operator's optional pitch context.
Produce a structured profile that strictly follows the supplied JSON schema.

Hard rules:
1. Stay strictly in B2B / professional context. Ignore and never emit
   personal information related to: health, family, marital status,
   sexuality, religion, politics, finances, or government IDs. If a source
   contains any such content, treat it as if it were not present.
2. Do not speculate. Only emit values that are directly supported by the
   provided excerpts. Use empty strings or empty arrays for fields you
   cannot ground.
3. `professional.cost_metrics` may only be filled when an explicit budget,
   headcount, or department-size figure appears in the excerpts. Otherwise
   emit "".
4. `outreach_strategy.how_we_benefit_them` must be derivable from items
   already present in `outreach_strategy.pain_points` or
   `professional.responsibilities`. If both are empty, emit "".
5. Do not invent URLs, emails, or social handles. Only emit values that
   appear verbatim in the excerpts.
6. Prefer concise, factual phrasings. Bullet-style verbs for list items.
"""


async def extract_profile(
    request: ProfileRequest,
    chunks: Sequence[Chunk],
    *,
    llm: LLMProvider,
    model: str | None = None,
) -> Profile:
    """Run a single LLM call and return a validated `Profile`."""
    user = render_user_prompt(request, chunks)
    return await llm.complete_json(
        system=SYSTEM_PROMPT,
        user=user,
        schema=Profile,
        model=model,
    )


def render_user_prompt(request: ProfileRequest, chunks: Sequence[Chunk]) -> str:
    """Build the user message; exposed for tests + golden-snapshot reviews."""
    lines: list[str] = [f"Target name: {request.target_name}"]
    if request.company_name:
        lines.append(f"Company: {request.company_name}")
    if request.context_goal:
        lines.append(f"Operator pitch context: {request.context_goal}")
    lines.append("")
    if not chunks:
        lines.append("(No source excerpts were retained. Return an empty profile.)")
        return "\n".join(lines)
    lines.append("Distilled source excerpts:")
    for i, chunk in enumerate(chunks, start=1):
        lines.append("")
        lines.append(f"--- excerpt {i} from {chunk.page_url} ---")
        lines.append(chunk.text)
    return "\n".join(lines)


__all__ = ["SYSTEM_PROMPT", "extract_profile", "render_user_prompt"]
