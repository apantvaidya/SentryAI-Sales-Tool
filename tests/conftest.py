"""Shared pytest fixtures."""

from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker
from sqlmodel.ext.asyncio.session import AsyncSession

from sentry_scraper_module.persistence.database import (
    create_all,
    make_engine,
    make_session_factory,
)
from sentry_scraper_module.persistence.repository import ensure_default_tenant
from sentry_scraper_module.providers.embeddings import HashEmbeddings

FIXTURES_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture
def fixtures_dir() -> Path:
    return FIXTURES_DIR


@pytest.fixture
def fixture_html() -> dict[str, str]:
    """Map fixture stem (e.g. `linkedin_profile`) to its raw HTML."""
    return {
        path.stem: path.read_text(encoding="utf-8") for path in sorted(FIXTURES_DIR.glob("*.html"))
    }


@pytest.fixture
def hash_embeddings() -> HashEmbeddings:
    return HashEmbeddings(dim=64)


@pytest_asyncio.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    """Fresh in-memory SQLite engine with every table created."""
    engine = make_engine("sqlite+aiosqlite:///:memory:")
    await create_all(engine)
    try:
        yield engine
    finally:
        await engine.dispose()


@pytest_asyncio.fixture
async def session_factory(
    engine: AsyncEngine,
) -> async_sessionmaker[AsyncSession]:
    return make_session_factory(engine)


@pytest_asyncio.fixture
async def session(
    session_factory: async_sessionmaker[AsyncSession],
) -> AsyncIterator[AsyncSession]:
    """Session pre-bootstrapped with the default tenant."""
    async with session_factory() as s:
        await ensure_default_tenant(s)
        yield s
