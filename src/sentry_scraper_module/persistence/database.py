"""Async SQLAlchemy / SQLModel engine + session helpers.

Cross-database by design: the same model + repository code runs against
SQLite (`sqlite+aiosqlite://`) for tests / local dev and Postgres
(`postgresql+asyncpg://`) for production. SQLModel + SQLAlchemy 2's `Uuid`
and `JSON` types take care of the dialect-specific storage.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine
from sqlmodel import SQLModel
from sqlmodel.ext.asyncio.session import AsyncSession


def make_engine(database_url: str, *, echo: bool = False) -> AsyncEngine:
    """Build an async engine for the given DSN."""
    return create_async_engine(database_url, echo=echo, future=True)


def make_session_factory(
    engine: AsyncEngine,
) -> async_sessionmaker[AsyncSession]:
    """Return a configured `async_sessionmaker` bound to `engine`."""
    return async_sessionmaker(
        bind=engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )


async def create_all(engine: AsyncEngine) -> None:
    """Create every table declared on `SQLModel.metadata`.

    Phase 2 dev/test convenience. Production migrations should be managed
    with Alembic; that wiring lands later.
    """
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)


@asynccontextmanager
async def session_scope(
    factory: async_sessionmaker[AsyncSession],
) -> AsyncIterator[AsyncSession]:
    """Yield a session and commit/rollback around it."""
    session = factory()
    try:
        yield session
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    finally:
        await session.close()


__all__ = [
    "create_all",
    "make_engine",
    "make_session_factory",
    "session_scope",
]
