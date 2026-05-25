"""Application settings loaded from environment / .env file."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

LogLevel = Literal["DEBUG", "INFO", "WARNING", "ERROR"]
LogFormat = Literal["console", "json"]
AppEnv = Literal["dev", "staging", "prod"]


class Settings(BaseSettings):
    """Top-level runtime configuration.

    Phase 0 only exposes runtime-shaping fields. Each subsequent phase will
    extend this class with its own optional fields (LLM keys, DSNs, etc.).
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_env: AppEnv = "dev"
    log_level: LogLevel = "INFO"
    log_format: LogFormat = "console"

    # Phase 2 — persistence + external service credentials.
    # Default DSN is file-backed SQLite for ergonomic local dev. Production
    # is expected to point this at Postgres (`postgresql+asyncpg://...`).
    database_url: str = "sqlite+aiosqlite:///./sentry.db"
    # Redis is optional in dev: cache + rate-limit fall back to in-memory
    # adapters when this is unset. The arq worker (Phase 2) requires it
    # explicitly. Set via `REDIS_URL=redis://...` in production.
    redis_url: str | None = None

    # Phase 1/2 — provider credentials. Optional; the corresponding Fake
    # adapters are wired automatically when these are unset.
    serper_api_key: str | None = None
    openai_api_key: str | None = None
    anthropic_api_key: str | None = None

    # Phase 3 — anti-bot infrastructure credentials.
    # When all three (smartproxy_username, smartproxy_password) are set, the
    # worker routes outbound HTTP through the residential pool.
    # When `browserless_token` is set, headless escalation uses
    # Browserless.io; otherwise the StubBrowser fallback applies.
    smartproxy_username: str | None = None
    smartproxy_password: str | None = None
    browserless_token: str | None = None

    # Phase 5 — schema management.
    # When True (default), the API lifespan calls `SQLModel.metadata.
    # create_all` on startup. Convenient for tests + dev, but production
    # should set this to False and run `alembic upgrade head` as a
    # deploy step so schema drift surfaces explicitly.
    auto_create_tables: bool = True

    # Phase 5 — per-tenant rate limiting (token bucket).
    # `rate_limit_per_minute=0` disables the limiter entirely (default in
    # tests). `rate_limit_burst` is the bucket size; defaults to 2× the
    # per-minute rate so short bursts don't get clipped.
    rate_limit_per_minute: int = 0
    rate_limit_burst: int = 0

    # Phase 5 — cache TTLs (seconds). 0 disables the corresponding cache.
    cache_serp_ttl_seconds: int = 60 * 60 * 24  # 24h
    cache_profile_ttl_seconds: int = 60 * 60 * 24 * 7  # 7d

    # Phase 5 — observability.
    # `metrics_enabled=True` mounts a Prometheus exporter at `/metrics`.
    # OTel exporter is opt-in via `otel_exporter_endpoint` (e.g.
    # `http://otel-collector:4318/v1/traces`); leave blank to disable.
    metrics_enabled: bool = True
    otel_exporter_endpoint: str | None = None
    otel_service_name: str = "sentry-scraper-module"

    # Phase 2 — bootstrap API keys for static auth.
    # Format: comma-separated `tenant_slug:plaintext_key` pairs. Parsed into
    # a {plaintext_key: tenant_slug} mapping at load time so the auth
    # dependency can do an O(1) lookup. Phase 4 swaps this for an `api_keys`
    # table with hashed keys; the env-driven flow stays for local dev.
    bootstrap_api_keys: str | None = None

    @field_validator("bootstrap_api_keys")
    @classmethod
    def _validate_bootstrap_api_keys(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        # Eagerly validate the format so misconfigurations fail fast at
        # startup rather than on the first authenticated request.
        for entry in value.split(","):
            entry = entry.strip()
            if not entry:
                continue
            if entry.count(":") != 1 or entry.startswith(":") or entry.endswith(":"):
                raise ValueError(f"BOOTSTRAP_API_KEYS entry '{entry}' must be 'slug:key'.")
        return value

    def parsed_api_keys(self) -> dict[str, str]:
        """Return the `{plaintext_key: tenant_slug}` map for auth lookups."""
        if not self.bootstrap_api_keys:
            return {}
        mapping: dict[str, str] = {}
        for entry in self.bootstrap_api_keys.split(","):
            entry = entry.strip()
            if not entry:
                continue
            slug, _, key = entry.partition(":")
            mapping[key.strip()] = slug.strip()
        return mapping


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return a process-wide cached `Settings` instance.

    Tests that need to override values should construct `Settings(...)`
    directly and pass it into `create_app(settings=...)`.
    """
    return Settings()
