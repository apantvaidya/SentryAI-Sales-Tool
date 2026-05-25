"""Unit tests for `providers.proxy`."""

from __future__ import annotations

import uuid

import pytest

from sentry_scraper_module.providers.proxy import (
    DEFAULT_SMARTPROXY_HOST,
    DEFAULT_SMARTPROXY_PORT,
    MockProxy,
    ProxySession,
    SmartproxyProvider,
)


def test_mock_proxy_returns_session_with_no_proxy_url() -> None:
    proxy = MockProxy()
    tenant = uuid.uuid4()
    job = uuid.uuid4()

    session = proxy.session(tenant_id=tenant, job_id=job)

    assert isinstance(session, ProxySession)
    assert session.proxy_url is None
    assert session.session_id  # non-empty
    assert proxy.calls == [(tenant, job)]


def test_mock_proxy_session_id_is_deterministic_for_same_inputs() -> None:
    proxy = MockProxy()
    tenant = uuid.uuid4()
    job = uuid.uuid4()

    first = proxy.session(tenant_id=tenant, job_id=job).session_id
    second = proxy.session(tenant_id=tenant, job_id=job).session_id

    assert first == second


def test_mock_proxy_session_id_differs_across_jobs() -> None:
    proxy = MockProxy()
    tenant = uuid.uuid4()

    a = proxy.session(tenant_id=tenant, job_id=uuid.uuid4()).session_id
    b = proxy.session(tenant_id=tenant, job_id=uuid.uuid4()).session_id

    assert a != b


def test_smartproxy_rejects_empty_credentials() -> None:
    with pytest.raises(ValueError):
        SmartproxyProvider(username="", password="x")
    with pytest.raises(ValueError):
        SmartproxyProvider(username="x", password="")


def test_smartproxy_builds_session_sticky_url() -> None:
    proxy = SmartproxyProvider(username="user", password="pass")
    tenant = uuid.UUID("11111111-1111-1111-1111-111111111111")
    job = uuid.UUID("22222222-2222-2222-2222-222222222222")

    session = proxy.session(tenant_id=tenant, job_id=job)

    assert session.proxy_url is not None
    assert session.proxy_url.startswith("http://user-session-")
    assert ":pass@" in session.proxy_url
    assert f"@{DEFAULT_SMARTPROXY_HOST}:{DEFAULT_SMARTPROXY_PORT}" in session.proxy_url
    # The session ID is the deterministic suffix between `-session-` and `:`.
    head = "http://user-session-"
    tail = ":pass@"
    encoded_session = session.proxy_url[len(head) : session.proxy_url.index(tail)]
    assert encoded_session == session.session_id


def test_smartproxy_same_job_yields_same_url() -> None:
    proxy = SmartproxyProvider(username="user", password="pass")
    tenant = uuid.uuid4()
    job = uuid.uuid4()

    a = proxy.session(tenant_id=tenant, job_id=job)
    b = proxy.session(tenant_id=tenant, job_id=job)

    assert a == b


def test_smartproxy_different_jobs_yield_different_urls() -> None:
    proxy = SmartproxyProvider(username="user", password="pass")
    tenant = uuid.uuid4()

    a = proxy.session(tenant_id=tenant, job_id=uuid.uuid4())
    b = proxy.session(tenant_id=tenant, job_id=uuid.uuid4())

    assert a.proxy_url != b.proxy_url
    assert a.session_id != b.session_id


def test_smartproxy_custom_host_and_port_propagate() -> None:
    proxy = SmartproxyProvider(
        username="user",
        password="pass",
        host="proxy.example.com",
        port=8000,
    )
    session = proxy.session(tenant_id=uuid.uuid4(), job_id=uuid.uuid4())
    assert session.proxy_url is not None
    assert "@proxy.example.com:8000" in session.proxy_url
