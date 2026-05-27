"""End-to-end smoke test for SentryScraperModule. Phase 5 deliverable.

Submits a single profile-build job, polls until the worker reaches a
terminal state, and asserts the response shape. Exits 0 on success, 1
on any failure (HTTP, timeout, schema, unexpected status).

Stdlib-only so it runs in any environment that has the API reachable —
no `pip install` step required, even on a freshly provisioned Fly
machine. Use it for:

  * Local Tier 2 (`uvicorn ...`):
      python scripts/smoke.py --api-key dev-key

  * Local Tier 3 (`docker compose up`):
      python scripts/smoke.py \\
          --base-url http://localhost:8000 --api-key dev-key

  * Staging:
      python scripts/smoke.py \\
          --base-url https://sentry-scraper-module.fly.dev \\
          --api-key "$STAGING_API_KEY"

The script is intentionally agnostic about *which* providers are wired:
on a fakes-only deployment the result will reflect canned data; with
real keys it will be a live profile build. Either way, the contract
under test is "POST → terminal status with the documented schema".
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from typing import Any

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

DEFAULT_BASE_URL = "http://127.0.0.1:8000"
DEFAULT_TARGET_NAME = "Jane Smith"
DEFAULT_COMPANY_NAME = "Acme Corp"
DEFAULT_CONTEXT_GOAL = "developer-tooling sales pitch"
DEFAULT_TIMEOUT_SECONDS = 120
DEFAULT_POLL_INTERVAL_SECONDS = 1.0

TERMINAL_STATES = {"done", "failed", "cancelled"}


# ---------------------------------------------------------------------------
# HTTP helpers (stdlib so we can run this anywhere)
# ---------------------------------------------------------------------------


class SmokeError(RuntimeError):
    """Raised when any expectation is violated. Caught by main()."""


def _request(
    method: str,
    url: str,
    *,
    api_key: str,
    body: dict[str, Any] | None = None,
    timeout: float = 15.0,
) -> tuple[int, dict[str, Any]]:
    """Issue a single request. Returns `(status_code, parsed_json)`.

    Non-2xx responses are returned (not raised) so the caller can pull
    the structured error envelope out of the body.
    """
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("X-API-Key", api_key)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "application/json")

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = resp.read().decode("utf-8")
            return resp.status, json.loads(payload) if payload else {}
    except urllib.error.HTTPError as exc:
        # FastAPI returns JSON envelopes on 4xx/5xx; surface the body so
        # callers can include the `error.code` in their failure message.
        raw = exc.read().decode("utf-8") if exc.fp else ""
        try:
            return exc.code, json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            return exc.code, {"raw": raw}


# ---------------------------------------------------------------------------
# Smoke flow
# ---------------------------------------------------------------------------


def submit_job(
    base_url: str,
    *,
    api_key: str,
    target_name: str,
    company_name: str,
    context_goal: str,
) -> str:
    """POST /v1/profiles. Returns the new `job_id`."""
    status, body = _request(
        "POST",
        f"{base_url}/v1/profiles",
        api_key=api_key,
        body={
            "target_name": target_name,
            "company_name": company_name,
            "context_goal": context_goal,
        },
    )
    if status != 202:
        raise SmokeError(f"POST /v1/profiles returned {status}: {body!r}")
    job_id = body.get("job_id")
    if not isinstance(job_id, str):
        raise SmokeError(f"POST response missing job_id: {body!r}")
    return job_id


def poll_until_terminal(
    base_url: str,
    job_id: str,
    *,
    api_key: str,
    timeout_seconds: float,
    interval_seconds: float,
) -> dict[str, Any]:
    """GET /v1/profiles/{job_id} repeatedly until status is terminal.

    Raises SmokeError on timeout. Returns the final response body.
    """
    deadline = time.monotonic() + timeout_seconds
    last_stage: str | None = None
    while True:
        status, body = _request(
            "GET",
            f"{base_url}/v1/profiles/{job_id}",
            api_key=api_key,
        )
        if status != 200:
            raise SmokeError(
                f"GET /v1/profiles/{job_id} returned {status}: {body!r}",
            )

        job_status = body.get("status")
        stage = body.get("stage")
        if stage and stage != last_stage:
            print(f"  stage -> {stage}")
            last_stage = stage

        if job_status in TERMINAL_STATES:
            return body

        if time.monotonic() >= deadline:
            raise SmokeError(
                f"Job {job_id} still {job_status!r} after {timeout_seconds}s "
                f"(last stage: {last_stage!r}).",
            )
        time.sleep(interval_seconds)


def assert_done_shape(body: dict[str, Any], *, strict: bool) -> None:
    """Validate the documented schema of a successful poll response.

    The default mode only checks structure (status=done + nested types),
    which works against a fakes-only deployment that returns an empty
    `Profile()` by design (`worker/providers._build_llm`). Pass
    `strict=True` once real provider keys are wired to additionally
    require a non-empty name and confidence > 0.
    """
    if body.get("status") != "done":
        err = body.get("error") or {}
        raise SmokeError(
            f"Expected status=done, got {body.get('status')!r}; "
            f"error={err.get('code')!r} ({err.get('message')!r}).",
        )

    result = body.get("result")
    if not isinstance(result, dict):
        raise SmokeError("Result missing or wrong type on a done job.")

    profile = result.get("profile")
    metadata = result.get("metadata")
    if not isinstance(profile, dict) or not isinstance(metadata, dict):
        raise SmokeError(
            "result.profile / result.metadata missing or wrong type.",
        )

    # Schema-level checks (always enforced).
    if not isinstance(profile.get("personal"), dict):
        raise SmokeError("profile.personal missing or wrong type.")
    if not isinstance(profile.get("professional"), dict):
        raise SmokeError("profile.professional missing or wrong type.")

    confidence = metadata.get("confidence_score")
    if not isinstance(confidence, (int, float)):
        raise SmokeError(
            f"metadata.confidence_score missing or wrong type: {confidence!r}.",
        )

    sources = metadata.get("sources_used")
    if not isinstance(sources, list):
        raise SmokeError(
            f"metadata.sources_used missing or wrong type: {sources!r}.",
        )

    # Content-level checks (only with real provider keys).
    if strict:
        name = profile["personal"].get("name")
        if not isinstance(name, str) or not name.strip():
            raise SmokeError(
                f"--strict: profile.personal.name missing or empty: {name!r}.",
            )
        if not (isinstance(confidence, (int, float)) and confidence > 0):
            raise SmokeError(
                f"--strict: metadata.confidence_score must be > 0: {confidence!r}.",
            )
        if not sources:
            raise SmokeError("--strict: metadata.sources_used is empty.")


def healthz_ok(base_url: str, *, api_key: str) -> None:
    """Sanity-check the service is reachable before we start posting."""
    status, body = _request("GET", f"{base_url}/healthz", api_key=api_key)
    if status != 200:
        raise SmokeError(f"GET /healthz returned {status}: {body!r}")
    if not body.get("ok"):
        raise SmokeError(f"/healthz returned non-ok body: {body!r}")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="POST a profile-build job, poll to terminal, assert success.",
    )
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument(
        "--api-key",
        required=True,
        help="X-API-Key value. Must match BOOTSTRAP_API_KEYS or a hashed row.",
    )
    parser.add_argument("--target-name", default=DEFAULT_TARGET_NAME)
    parser.add_argument("--company-name", default=DEFAULT_COMPANY_NAME)
    parser.add_argument("--context-goal", default=DEFAULT_CONTEXT_GOAL)
    parser.add_argument(
        "--timeout",
        type=float,
        default=DEFAULT_TIMEOUT_SECONDS,
        help="Max seconds to wait for the job to reach a terminal state.",
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=DEFAULT_POLL_INTERVAL_SECONDS,
        help="Seconds between GET polls.",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help=(
            "Also require non-empty profile.personal.name, confidence > 0, "
            "and at least one source. Use against a deployment with real "
            "provider keys (OPENAI_API_KEY + SERPER_API_KEY)."
        ),
    )
    args = parser.parse_args(argv)

    base_url = args.base_url.rstrip("/")

    try:
        print(f"[1/3] healthz check against {base_url}")
        healthz_ok(base_url, api_key=args.api_key)
        print("      ok")

        print(
            f"[2/3] POST /v1/profiles (target={args.target_name!r}, company={args.company_name!r})",
        )
        job_id = submit_job(
            base_url,
            api_key=args.api_key,
            target_name=args.target_name,
            company_name=args.company_name,
            context_goal=args.context_goal,
        )
        print(f"      job_id={job_id}")

        print(f"[3/3] poll until terminal (timeout={args.timeout}s)")
        body = poll_until_terminal(
            base_url,
            job_id,
            api_key=args.api_key,
            timeout_seconds=args.timeout,
            interval_seconds=args.interval,
        )
        assert_done_shape(body, strict=args.strict)

        result = body["result"]
        profile = result["profile"]
        metadata = result["metadata"]
        print()
        print("SMOKE PASSED")
        print(f"  job_id            = {job_id}")
        print(f"  name              = {profile['personal'].get('name')!r}")
        print(f"  title             = {profile['professional'].get('title')!r}")
        print(f"  company           = {profile['professional'].get('company')!r}")
        print(f"  confidence        = {metadata['confidence_score']:.3f}")
        print(f"  sources           = {len(metadata['sources_used'])}")
        print(f"  generated_at      = {metadata.get('generated_at')}")
        return 0

    except SmokeError as exc:
        print(f"\nSMOKE FAILED: {exc}", file=sys.stderr)
        return 1
    except urllib.error.URLError as exc:
        print(
            f"\nSMOKE FAILED: cannot reach {base_url} ({exc.reason}).",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
