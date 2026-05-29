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

Your PRIMARY deliverable is a well-populated `outreach_strategy`. The whole
point of the profile is to enable personalized outreach, so treat
`outreach_strategy.pain_points` and `outreach_strategy.how_we_benefit_them`
as the highest-value fields. Work hard to fill them whenever the excerpts
give you any legitimate basis to do so.

Hard rules:
1. Stay strictly in B2B / professional context. Ignore and never emit
   personal information related to: health, family, marital status,
   sexuality, religion, politics, finances, or government IDs. If a source
   contains any such content, treat it as if it were not present.
2. Do not fabricate. Every value must trace back to the excerpts. You MAY,
   however, make grounded professional inferences: pain points and
   priorities reasonably implied by the target's documented role, seniority,
   responsibilities, company, or industry count as supported, as long as the
   inference is tied to specifics that actually appear in the excerpts. What
   is forbidden is inventing facts, names, numbers, or quotes out of thin air.
3. `professional.cost_metrics` may only be filled when an explicit budget,
   headcount, or department-size figure appears in the excerpts. Otherwise
   emit "".
4. `outreach_strategy.pain_points`: populate this whenever the excerpts
   surface — explicitly OR by grounded inference from role/responsibilities/
   industry — challenges, bottlenecks, risks, stated priorities, or
   initiatives the target or their company would plausibly care about. Phrase
   each as a concise business pain. Only leave it empty if there is genuinely
   no professional signal to work from.
5. `outreach_strategy.how_we_benefit_them`: attempt this whenever ANY of
   `outreach_strategy.pain_points`, `professional.responsibilities`, or the
   operator pitch context is non-empty. Connect the target's pains/role to a
   concrete, concise benefit narrative, anchored in the operator pitch
   context when provided. Only emit "" if you have no professional context
   AND no pitch context at all.
6. Do not invent URLs, emails, or social handles. Only emit values that
   appear verbatim in the excerpts.
7. Prefer concise, factual phrasings. Bullet-style verbs for list items.
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
    lines.append(
        "Priority: the `outreach_strategy` section is the most important "
        "output. Make a genuine effort to populate `pain_points` (grounded "
        "in or reasonably inferred from the excerpts below) and to write a "
        "`how_we_benefit_them` narrative tying those pains and the target's "
        "role to the operator pitch context. Do not fabricate."
    )
    if request.mode == "deep":
        # Deep mode pulled pain-point / "problems we solve" excerpts on
        # purpose, so instruct the model to actively mine them. Rules 2 and 4
        # in the system prompt still bind: every emitted item must be
        # grounded in the excerpts below.
        lines.append("")
        lines.append(
            "Extraction focus (deep mode): scan the excerpts for explicit "
            "business challenges, bottlenecks, stated priorities, and "
            "initiatives the target or their company has voiced. Populate "
            "`outreach_strategy.pain_points` with each grounded item, then "
            "write `how_we_benefit_them` connecting those pain points (and "
            "the operator pitch context, if given) to a concise benefit "
            "narrative. Do not fabricate: omit anything the excerpts do not "
            "support."
        )
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
