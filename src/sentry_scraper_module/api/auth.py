"""Static API-key auth.

Two lookup paths, tried in order:

1. **Hashed `api_keys` table** (Phase 4) — production. Plaintext keys are
   never stored; the dependency hashes the header and queries by
   `key_hash`. Revoked keys are ignored. The matched row's
   `last_used_at` is bumped opportunistically.
2. **Bootstrap mapping** (Phase 2) — dev convenience. The
   `BOOTSTRAP_API_KEYS` env var maps `slug:key` pairs into an in-memory
   table. Useful for local runs without seeding `api_keys`.

Routes depend only on `require_tenant`, so the two paths are
interchangeable from a route's perspective.
"""

from __future__ import annotations

from fastapi import Depends, Header, Request
from sqlmodel.ext.asyncio.session import AsyncSession

from sentry_scraper_module.api.dependencies import get_session
from sentry_scraper_module.core.config import Settings
from sentry_scraper_module.core.errors import ProfilingError
from sentry_scraper_module.persistence.models import Tenant
from sentry_scraper_module.persistence.repository import (
    find_tenant_by_api_key,
    get_tenant_by_slug,
)

API_KEY_HEADER = "X-API-Key"


class UnauthorizedError(ProfilingError):
    """401 — missing or invalid API key."""

    code = "UNAUTHORIZED"
    http_status = 401
    retryable = False


def _resolve_settings(request: Request) -> Settings:
    settings: Settings | None = getattr(request.app.state, "settings", None)
    if settings is None:  # pragma: no cover - defensive; lifespan always sets it.
        raise UnauthorizedError("Auth not configured.")
    return settings


async def require_tenant(
    request: Request,
    x_api_key: str | None = Header(default=None, alias=API_KEY_HEADER),
    session: AsyncSession = Depends(get_session),
) -> Tenant:
    """Resolve the calling tenant from the `X-API-Key` header.

    Tries the hashed `api_keys` table first; falls back to the
    `BOOTSTRAP_API_KEYS` mapping for dev. Raises `UnauthorizedError`
    if neither path resolves to a `Tenant` row.
    """
    if not x_api_key:
        raise UnauthorizedError(f"Missing {API_KEY_HEADER} header.")

    # Path 1: hashed api_keys table.
    tenant = await find_tenant_by_api_key(session, plaintext=x_api_key)
    if tenant is not None:
        return tenant

    # Path 2: bootstrap mapping (dev convenience).
    settings = _resolve_settings(request)
    mapping = settings.parsed_api_keys()
    slug = mapping.get(x_api_key)
    if slug is None:
        raise UnauthorizedError("Invalid API key.")

    bootstrap_tenant = await get_tenant_by_slug(session, slug)
    if bootstrap_tenant is None:
        # Bootstrap rows are created at startup, so a missing tenant here
        # means config drift between the env and the DB. Treat as auth
        # failure rather than 500 — the caller's key is valid but unusable.
        raise UnauthorizedError("Tenant not provisioned for this key.")
    return bootstrap_tenant


__all__ = [
    "API_KEY_HEADER",
    "UnauthorizedError",
    "require_tenant",
]
