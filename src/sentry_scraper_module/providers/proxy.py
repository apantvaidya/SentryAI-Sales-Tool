"""Residential proxy abstraction.

Production routes outbound traffic through Smartproxy's session-sticky
endpoint so every fetch in one profile build reuses one residential IP
(`docs/DESIGN.md §6.1`). The same session ID is also handed to the
headless browser so static + rendered fetches share the IP.

Tests and dev (no credentials) use `MockProxy`, which returns a session
with `proxy_url=None` — the caller treats that as "fetch directly".
"""

from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class ProxySession:
    """One residential session for the duration of a profile build.

    `session_id` is deterministic in `(tenant_id, job_id)` so retries and
    parallel pages within the same job share an IP; cross-job traffic gets
    a fresh session. `proxy_url`, when set, is an httpx-compatible
    `http://user:pass@host:port` string. `None` means direct fetch.
    """

    session_id: str
    proxy_url: str | None


class ProxyProvider(Protocol):
    """Resolve a `ProxySession` for the given (tenant, job) pair."""

    def session(self, *, tenant_id: uuid.UUID, job_id: uuid.UUID) -> ProxySession: ...


# ---------------------------------------------------------------------------
# Mock (dev / tests / no creds).
# ---------------------------------------------------------------------------


class MockProxy:
    """No-op provider. Records every call but never injects a proxy URL."""

    def __init__(self) -> None:
        self.calls: list[tuple[uuid.UUID, uuid.UUID]] = []

    def session(self, *, tenant_id: uuid.UUID, job_id: uuid.UUID) -> ProxySession:
        self.calls.append((tenant_id, job_id))
        return ProxySession(
            session_id=_derive_session_id(tenant_id, job_id),
            proxy_url=None,
        )


# ---------------------------------------------------------------------------
# Smartproxy residential adapter.
# ---------------------------------------------------------------------------


# Smartproxy's residential gateway uses one host + one port; the session is
# encoded into the username as `USERNAME-session-<id>`. Per their docs the
# session is sticky for up to 30 min, which comfortably covers a single
# profile build. See https://help.smartproxy.com/.
DEFAULT_SMARTPROXY_HOST = "gate.smartproxy.com"
DEFAULT_SMARTPROXY_PORT = 7000


class SmartproxyProvider:
    """Builds session-sticky residential proxy URLs.

    Construct with the credentials Smartproxy issues for a residential
    plan. Each call to `session()` rebuilds the URL with a deterministic
    session ID; nothing here actually opens a connection — that's the
    caller's job (httpx, Browserless).
    """

    def __init__(
        self,
        *,
        username: str,
        password: str,
        host: str = DEFAULT_SMARTPROXY_HOST,
        port: int = DEFAULT_SMARTPROXY_PORT,
    ) -> None:
        if not username or not password:
            raise ValueError("SmartproxyProvider requires non-empty username + password")
        self._username = username
        self._password = password
        self._host = host
        self._port = port

    def session(self, *, tenant_id: uuid.UUID, job_id: uuid.UUID) -> ProxySession:
        session_id = _derive_session_id(tenant_id, job_id)
        # Smartproxy expects `USERNAME-session-<id>:PASSWORD`. We keep the
        # credentials URL-safe by avoiding any user-controlled characters —
        # `session_id` is hex.
        proxy_url = (
            f"http://{self._username}-session-{session_id}:"
            f"{self._password}@{self._host}:{self._port}"
        )
        return ProxySession(session_id=session_id, proxy_url=proxy_url)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _derive_session_id(tenant_id: uuid.UUID, job_id: uuid.UUID) -> str:
    """Stable 16-hex-char session ID for `(tenant, job)`.

    Hashing keeps the wire form short (Smartproxy session IDs cap around
    32 chars) and lets us safely surface the value in logs without
    leaking the raw UUIDs.
    """
    payload = f"{tenant_id}:{job_id}".encode()
    return hashlib.sha256(payload).hexdigest()[:16]


__all__ = [
    "DEFAULT_SMARTPROXY_HOST",
    "DEFAULT_SMARTPROXY_PORT",
    "MockProxy",
    "ProxyProvider",
    "ProxySession",
    "SmartproxyProvider",
]
