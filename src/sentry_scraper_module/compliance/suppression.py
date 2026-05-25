"""Opt-out / suppression checks.

Used in two places per `docs/DESIGN.md §7.1`:
- At `POST /v1/profiles` acceptance — refuses suppressed targets with 451
  *before* any external work (SERP, fetch, LLM).
- After extraction, as a defense-in-depth pass — if a target was added to
  the suppression list mid-flight, the worker drops the result and
  records an audit entry.

The check is intentionally tenant-agnostic: suppression is a property of
the target, not the requestor. A request from any tenant for a
suppressed target is refused.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlmodel.ext.asyncio.session import AsyncSession

from sentry_scraper_module.api.schemas import ProfileRequest
from sentry_scraper_module.persistence.repository import is_suppressed


@dataclass(frozen=True)
class SuppressionCheck:
    """Result of a suppression lookup.

    `suppressed` is the boolean answer; `reason` carries the stored
    suppression reason when known (empty string when the row had no
    reason set). Callers should treat any `suppressed=True` as a hard
    block.
    """

    suppressed: bool
    reason: str = ""


async def check_suppression(
    session: AsyncSession,
    request: ProfileRequest,
) -> SuppressionCheck:
    """Return whether `request` targets a suppressed (name, company)."""
    suppressed = await is_suppressed(
        session,
        target_name=request.target_name,
        company_name=request.company_name,
    )
    return SuppressionCheck(suppressed=suppressed)


__all__ = ["SuppressionCheck", "check_suppression"]
