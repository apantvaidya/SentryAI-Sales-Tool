"""Unit tests for the `Settings` validator + helpers."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from sentry_scraper_module.core.config import Settings


def test_parsed_api_keys_returns_empty_when_unset() -> None:
    settings = Settings(bootstrap_api_keys=None)
    assert settings.parsed_api_keys() == {}


def test_parsed_api_keys_handles_single_pair() -> None:
    settings = Settings(bootstrap_api_keys="acme:secret")
    assert settings.parsed_api_keys() == {"secret": "acme"}


def test_parsed_api_keys_handles_multiple_pairs_and_whitespace() -> None:
    settings = Settings(bootstrap_api_keys=" acme:k1 , initech:k2 ")
    assert settings.parsed_api_keys() == {"k1": "acme", "k2": "initech"}


@pytest.mark.parametrize(
    "value",
    [
        "no-colon-here",
        ":missing-slug",
        "missing-key:",
        "too:many:colons",
    ],
)
def test_invalid_bootstrap_format_rejected(value: str) -> None:
    with pytest.raises(ValidationError):
        Settings(bootstrap_api_keys=value)


# ---------------------------------------------------------------------------
# Phase 3 — anti-bot infra credentials
# ---------------------------------------------------------------------------


def test_anti_bot_credentials_default_to_none() -> None:
    settings = Settings()
    assert settings.smartproxy_username is None
    assert settings.smartproxy_password is None
    assert settings.browserless_token is None


def test_anti_bot_credentials_load_from_kwargs() -> None:
    settings = Settings(
        smartproxy_username="sp-user",
        smartproxy_password="sp-pass",
        browserless_token="brw-token",
    )
    assert settings.smartproxy_username == "sp-user"
    assert settings.smartproxy_password == "sp-pass"
    assert settings.browserless_token == "brw-token"
