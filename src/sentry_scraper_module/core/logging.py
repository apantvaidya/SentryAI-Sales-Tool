"""Structured logging configuration backed by `structlog`."""

from __future__ import annotations

import logging
import sys
from typing import cast

import structlog
from structlog.types import FilteringBoundLogger, Processor

from sentry_scraper_module.core.config import Settings

_configured = False


def configure_logging(settings: Settings) -> None:
    """Configure `structlog` exactly once per process.

    Idempotent: subsequent calls are no-ops so test suites that build many
    apps do not re-register processors.
    """
    global _configured
    if _configured:
        return

    timestamper = structlog.processors.TimeStamper(fmt="iso", utc=True)

    shared_processors: list[Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        timestamper,
        structlog.processors.StackInfoRenderer(),
    ]

    # ConsoleRenderer formats exc_info on its own, so adding `format_exc_info`
    # before it triggers a UserWarning. Only include the formatter when the
    # final renderer cannot handle exc_info (i.e. JSON output).
    processors: list[Processor]
    if settings.log_format == "json":
        processors = [
            *shared_processors,
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ]
    else:
        processors = [
            *shared_processors,
            structlog.dev.ConsoleRenderer(colors=sys.stderr.isatty()),
        ]

    level = logging.getLevelNamesMapping()[settings.log_level]

    structlog.configure(
        processors=processors,
        wrapper_class=structlog.make_filtering_bound_logger(level),
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )
    _configured = True


def get_logger(name: str | None = None) -> FilteringBoundLogger:
    """Return a structlog logger bound under `name`."""
    return cast(FilteringBoundLogger, structlog.get_logger(name))
