"""Typed error hierarchy surfaced through the API.

Mirrors the error model in `docs/DESIGN.md §9`. Each error carries a stable
machine-readable code, an HTTP status, and a `retryable` flag so clients can
distinguish transient failures from permanent ones.
"""

from __future__ import annotations

from typing import Any, ClassVar

from pydantic import BaseModel, Field


class ErrorBody(BaseModel):
    """Wire format for the `error` field of a non-2xx response body."""

    code: str
    message: str
    stage: str | None = None
    retryable: bool = False
    details: dict[str, Any] = Field(default_factory=dict)


class ProfilingError(Exception):
    """Base class for all domain errors emitted by the profiling pipeline."""

    code: ClassVar[str] = "INTERNAL"
    http_status: ClassVar[int] = 500
    retryable: ClassVar[bool] = False

    def __init__(
        self,
        message: str,
        *,
        stage: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.stage = stage
        self.details: dict[str, Any] = details or {}

    def to_body(self) -> ErrorBody:
        return ErrorBody(
            code=self.code,
            message=self.message,
            stage=self.stage,
            retryable=self.retryable,
            details=self.details,
        )


class InvalidRequestError(ProfilingError):
    code = "INVALID_REQUEST"
    http_status = 400
    retryable = False


class SuppressedTargetError(ProfilingError):
    code = "SUPPRESSED"
    http_status = 451
    retryable = False


class InsufficientSourcesError(ProfilingError):
    code = "INSUFFICIENT_SOURCES"
    http_status = 422
    retryable = True


class UpstreamBlockedError(ProfilingError):
    code = "UPSTREAM_BLOCKED"
    http_status = 502
    retryable = True


class UpstreamTimeoutError(ProfilingError):
    code = "UPSTREAM_TIMEOUT"
    http_status = 504
    retryable = True


class ExtractionFailedError(ProfilingError):
    code = "EXTRACTION_FAILED"
    http_status = 502
    retryable = True


class InternalError(ProfilingError):
    code = "INTERNAL"
    http_status = 500
    retryable = False


class RateLimitedError(ProfilingError):
    """Raised when the per-tenant rate limiter rejects a request.

    Phase 5 wiring: surfaces as 429 with the same envelope shape as
    every other domain error, so clients can catch on `error.code` ==
    `RATE_LIMITED` instead of HTTP status alone.
    """

    code = "RATE_LIMITED"
    http_status = 429
    retryable = True


__all__ = [
    "ErrorBody",
    "ExtractionFailedError",
    "InsufficientSourcesError",
    "InternalError",
    "InvalidRequestError",
    "ProfilingError",
    "RateLimitedError",
    "SuppressedTargetError",
    "UpstreamBlockedError",
    "UpstreamTimeoutError",
]
