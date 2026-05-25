"""Compliance + privacy enforcement.

Three independent modules:

- `suppression` — opt-out list check, used twice (pre-fetch and
  post-extract per `docs/DESIGN.md §7.1`).
- `pii_filter` — category-based redaction of the extracted profile.
- `audit` — thin wrapper over `persistence.repository.record_audit_entry`
  for the common event types so callers don't have to construct payloads
  by hand.
"""

from sentry_scraper_module.compliance.audit import (
    log_erasure_request,
    log_pii_redaction,
    log_suppression_reject,
)
from sentry_scraper_module.compliance.pii_filter import (
    Redaction,
    redact_pii,
)
from sentry_scraper_module.compliance.suppression import (
    SuppressionCheck,
    check_suppression,
)

__all__ = [
    "Redaction",
    "SuppressionCheck",
    "check_suppression",
    "log_erasure_request",
    "log_pii_redaction",
    "log_suppression_reject",
    "redact_pii",
]
