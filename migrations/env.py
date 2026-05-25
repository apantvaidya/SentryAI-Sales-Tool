"""Alembic environment for SentryScraperModule.

Reads the database URL from `DATABASE_URL` (env var) so the same
migrations command works against SQLite (local), Postgres (compose,
Fly), and any future DSN. Falls back to the value in `alembic.ini` if
the env var is missing.

Wires `target_metadata` to SQLModel's metadata so `alembic revision
--autogenerate` reflects the current model state.
"""

from __future__ import annotations

import asyncio
import os
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config
from sqlmodel import SQLModel

from alembic import context

# Import all model modules so `SQLModel.metadata` is fully populated
# before Alembic reads it.
from sentry_scraper_module.persistence import models as _models  # noqa: F401

config = context.config

# Allow the runtime DSN to override the ini-file value. Production
# (Fly machines, docker-compose, CI) sets `DATABASE_URL`.
_runtime_url = os.environ.get("DATABASE_URL")
if _runtime_url:
    config.set_main_option("sqlalchemy.url", _runtime_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = SQLModel.metadata

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def _render_item(type_: str, obj: object, autogen_context: object) -> object:
    """Render SQLModel's `AutoString` as plain `sa.String()` in migrations.

    SQLModel attaches a custom `AutoString` type to string columns; Alembic
    autogenerate emits `sqlmodel.sql.sqltypes.AutoString()`, which requires
    a `sqlmodel` import in every migration. `AutoString` is `sa.String`
    underneath, so render it as such to keep migration files pure
    SQLAlchemy.
    """
    if type_ == "type" and obj.__class__.__module__.startswith("sqlmodel."):
        return "sa.String()"
    return False  # let Alembic use its default rendering


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        render_item=_render_item,
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """In this scenario we need to create an Engine
    and associate a connection with the context.

    """

    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""

    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
