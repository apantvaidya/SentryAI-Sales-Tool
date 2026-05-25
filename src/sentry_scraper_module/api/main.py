"""FastAPI application factory and module-level ASGI app."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

from sentry_scraper_module import __version__
from sentry_scraper_module.api.queue import InProcessQueue, JobQueue
from sentry_scraper_module.api.routes.erasure import router as erasure_router
from sentry_scraper_module.api.routes.profiles import router as profiles_router
from sentry_scraper_module.core.cache import build_cache
from sentry_scraper_module.core.config import Settings, get_settings
from sentry_scraper_module.core.errors import ProfilingError
from sentry_scraper_module.core.logging import configure_logging, get_logger
from sentry_scraper_module.core.metrics import render_metrics
from sentry_scraper_module.core.rate_limit import build_rate_limiter
from sentry_scraper_module.persistence.database import (
    create_all,
    make_engine,
    make_session_factory,
)
from sentry_scraper_module.persistence.repository import (
    ensure_default_tenant,
    upsert_tenant,
)
from sentry_scraper_module.worker.providers import build_run_deps
from sentry_scraper_module.worker.runner import execute_job

logger = get_logger(__name__)


def create_app(
    settings: Settings | None = None,
    *,
    queue_factory: Any | None = None,
) -> FastAPI:
    """Build and return a configured FastAPI application.

    Tests pass a custom `Settings` instance and (optionally) a
    `queue_factory(app, settings) -> JobQueue` to swap in an in-process
    queue with a stubbed runner. Production callers use defaults.
    """
    resolved = settings or get_settings()
    configure_logging(resolved)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        logger.info("startup", env=resolved.app_env, version=__version__)
        engine = make_engine(resolved.database_url)
        if resolved.auto_create_tables:
            # Dev / test convenience. Production sets `auto_create_tables
            # =False` and runs `alembic upgrade head` as a deploy step.
            await create_all(engine)
        session_factory = make_session_factory(engine)

        # Bootstrap rows: default tenant (always) + any tenants referenced
        # by `BOOTSTRAP_API_KEYS` so the auth dependency can resolve them.
        async with session_factory() as session:
            await ensure_default_tenant(session)
            for slug in set(resolved.parsed_api_keys().values()):
                await upsert_tenant(session, slug=slug)

        app.state.settings = resolved
        app.state.engine = engine
        app.state.session_factory = session_factory

        # Phase 5 — process-wide singletons that handlers consume via
        # FastAPI deps. `build_*` picks an in-memory adapter when no
        # external dependency is configured, so tests get a fully
        # functional cache + limiter without a Redis fixture.
        cache = build_cache(resolved.redis_url)
        rate_limiter = build_rate_limiter(
            redis_url=resolved.redis_url,
            per_minute=resolved.rate_limit_per_minute,
            burst=resolved.rate_limit_burst,
        )
        app.state.cache = cache
        app.state.rate_limiter = rate_limiter

        # Build the queue last so its handler can capture the session
        # factory. Default = in-process queue invoking the runner with the
        # production deps factory.
        if queue_factory is not None:
            queue: JobQueue = queue_factory(app, resolved)
        else:

            async def _handle(job_id: uuid.UUID) -> None:
                await execute_job(
                    job_id,
                    session_factory=session_factory,
                    deps_factory=lambda: build_run_deps(resolved),
                )

            queue = InProcessQueue(_handle)
        app.state.queue = queue

        try:
            yield
        finally:
            await queue.close()
            await rate_limiter.close()
            await cache.close()
            await engine.dispose()
            logger.info("shutdown")

    app = FastAPI(
        title="SentryScraperModule",
        version=__version__,
        lifespan=lifespan,
    )
    app.include_router(profiles_router)
    app.include_router(erasure_router)

    @app.get("/healthz", tags=["health"])
    async def healthz() -> dict[str, Any]:
        return {
            "ok": True,
            "version": __version__,
            "env": resolved.app_env,
        }

    if resolved.metrics_enabled:

        @app.get("/metrics", tags=["health"], include_in_schema=False)
        async def metrics() -> Response:
            body, content_type = render_metrics()
            return Response(content=body, media_type=content_type)

    @app.exception_handler(ProfilingError)
    async def handle_profiling_error(
        request: Request,
        exc: Exception,
    ) -> JSONResponse:
        assert isinstance(exc, ProfilingError)
        body = exc.to_body()
        logger.warning(
            "profiling_error",
            code=body.code,
            stage=body.stage,
            path=request.url.path,
        )
        return JSONResponse(
            status_code=exc.http_status,
            content={"error": body.model_dump()},
        )

    @app.exception_handler(Exception)
    async def handle_unhandled(
        request: Request,
        exc: Exception,
    ) -> JSONResponse:
        logger.exception(
            "unhandled_error",
            path=request.url.path,
            error_type=type(exc).__name__,
        )
        return JSONResponse(
            status_code=500,
            content={
                "error": {
                    "code": "INTERNAL",
                    "message": "Unhandled internal error.",
                    "retryable": False,
                    "details": {},
                }
            },
        )

    return app


app = create_app()
