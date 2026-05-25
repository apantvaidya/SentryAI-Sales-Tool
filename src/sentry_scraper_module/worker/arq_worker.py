"""arq `WorkerSettings` for the production job runner.

`run_profile_job` is the single registered task; the API enqueues it by
name from `ArqQueue.enqueue`. Each invocation builds a fresh DB engine /
session factory and `RunDeps`, runs `execute_job`, and tears them down.
"""

from __future__ import annotations

import uuid
from typing import Any

from arq.connections import RedisSettings

from sentry_scraper_module.core.config import Settings, get_settings
from sentry_scraper_module.core.logging import configure_logging, get_logger
from sentry_scraper_module.persistence.database import (
    make_engine,
    make_session_factory,
)
from sentry_scraper_module.worker.providers import build_run_deps
from sentry_scraper_module.worker.runner import execute_job

logger = get_logger(__name__)


async def run_profile_job(ctx: dict[str, Any], job_id_str: str) -> None:
    """arq task: run one profile job by ID."""
    settings: Settings = ctx["settings"]
    session_factory = ctx["session_factory"]
    job_id = uuid.UUID(job_id_str)

    def deps_factory() -> Any:
        return build_run_deps(settings)

    await execute_job(
        job_id,
        session_factory=session_factory,
        deps_factory=deps_factory,
    )


async def startup(ctx: dict[str, Any]) -> None:
    settings = get_settings()
    configure_logging(settings)
    engine = make_engine(settings.database_url)
    ctx["settings"] = settings
    ctx["engine"] = engine
    ctx["session_factory"] = make_session_factory(engine)
    logger.info("arq_worker_startup", env=settings.app_env)


async def shutdown(ctx: dict[str, Any]) -> None:
    engine = ctx.get("engine")
    if engine is not None:
        await engine.dispose()
    logger.info("arq_worker_shutdown")


class WorkerSettings:
    """Module-level entry point for `arq sentry_scraper_module.worker.arq_worker.WorkerSettings`."""

    functions = [run_profile_job]
    on_startup = startup
    on_shutdown = shutdown

    @staticmethod
    def redis_settings_from_env() -> RedisSettings:
        url = get_settings().redis_url
        if not url:
            raise RuntimeError(
                "REDIS_URL must be set when running the arq worker. "
                "The in-memory queue path is for dev only."
            )
        return RedisSettings.from_dsn(url)


__all__ = ["WorkerSettings", "run_profile_job", "shutdown", "startup"]
