# Context Log — SentryScraperModule

> Working memory for Cascade across sessions. Append session entries to the
> bottom; update **Status** and **Open items** at the top whenever they
> change. The canonical specs live in `docs/PRD.md`, `docs/DESIGN.md`,
> `docs/PLAN.md`. This file is only a working log — never a substitute.

---

## Status

- **Phase 0 — Repo skeleton: COMPLETE.**
- **Phase 1 — Core pipeline (no orchestrator): COMPLETE.**
- **Phase 2 — Orchestration + async API: COMPLETE.**
- **Phase 3 — Anti-bot infrastructure: COMPLETE.**
- **Phase 4 — Compliance + hashed API keys: COMPLETE.**
- **Phase 5 — Hardening + deploy: ~95% COMPLETE** (code + infra files
  shipped; remaining: docker-compose smoke + live `fly deploy` smoke +
  optional OpenTelemetry). Tier 2 (uvicorn + fakes) verified
  end-to-end via `scripts/smoke.py`.
- All Phase 4 exit criteria from `docs/PLAN.md §Phase 4` met:
  - `persistence/models.py` — `ApiKey` (sha256 `key_hash`, `label`,
    `last_used_at`, `revoked_at`), `Suppression` (sha256 `target_hash`,
    `reason`), `AuditEntry` (append-only, nullable `tenant_id`/`job_id`,
    JSON `payload`). Helpers `hash_api_key` + `hash_target` are pure
    sha256-hex; `hash_target` lower-cases + trims so casing / whitespace
    can't slip a suppressed identity through.
  - `persistence/repository.py` — `upsert_tenant`, `create_api_key`,
    `find_tenant_by_api_key` (revoked rows skipped, `last_used_at`
    bumped on hit), `revoke_api_key`, `add_suppression`,
    `is_suppressed`, `purge_jobs_for_target` (Python-side filter for
    SQLite/Postgres portability), `record_audit_entry`,
    `list_audit_entries`.
  - `compliance/suppression.py` — `check_suppression(session,
    request) -> SuppressionCheck` thin wrapper used by both POST and
    the worker's post-extraction re-check.
  - `compliance/pii_filter.py` — `redact_pii(profile)` walks every
    string + list-of-strings field of `Profile`, scrubs PII against
    five regex categories (health, family, religion, government_id,
    financial_personal), drops list items that *contain* a match, and
    inlines `[redacted:<category>]` markers in scalars. Returns
    `(cleaned_profile, [Redaction(field, category, matched_term)])`.
  - `compliance/audit.py` — three typed helpers
    (`log_pii_redaction`, `log_suppression_reject`,
    `log_erasure_request`) plus `EVENT_*` constants so audit-row
    `event_type` strings stay consistent.
  - `api/auth.py::require_tenant` — tries the hashed `api_keys` table
    first (Phase 4); falls back to `BOOTSTRAP_API_KEYS` (Phase 2) for
    dev. Revoked rows return 401.
  - `api/routes/profiles.py::create_profile_job` — checks suppression
    before enqueuing and raises `SuppressedTargetError` (451) with a
    `suppression_reject` audit row tagged `stage="accept"`.
  - `worker/runner.execute_job` — after the pipeline emits a profile,
    re-checks suppression (defends against erasure-mid-flight) and
    runs `redact_pii`. Suppressed mid-flight → `mark_failed
    (code=SUPPRESSED)` with no result row written. PII redactions →
    audit row + cleaned profile persisted.
  - `api/routes/erasure.py` — `DELETE /v1/erasure` accepts
    `{target_name, company_name?}` or `{email}`; adds suppression,
    purges matching jobs (only for the `target_name` variant), logs
    an `erasure_request` audit row, returns
    `{accepted, target_hash, purged_job_count}`. Suppression is
    global; matching is by hash, never by raw identity.
  - 192 tests pass at **86% total coverage** (up from 85%). New tests:
    `test_compliance.py` (21), `test_compliance_api.py` (12), +2 in
    `test_runner.py` (post-extraction suppression + PII redaction).
    `ruff`, `ruff format --check`, `mypy --strict` all clean across
    73 source files.
- All Phase 3 exit criteria from `docs/PLAN.md §Phase 3` met
  (except the live integration test, which is intentionally gated):
  - `providers/proxy.py` — `ProxyProvider` Protocol; `SmartproxyProvider`
    builds session-sticky URLs (`USERNAME-session-<id>:PASS@gate:7000`);
    `MockProxy` returns `proxy_url=None`. Session ID = first 16 hex
    chars of `sha256(tenant_id:job_id)`, so retries + parallel pages
    inside one job share an IP.
  - `core/fingerprint.py` — `build_fingerprint(session_id)` samples a
    coherent header set (UA + matched `sec-ch-ua{,-mobile,-platform}` +
    `Accept*` + `Sec-Fetch-*`) deterministically per session. Curated
    pool covers Chrome on macOS/Windows, Safari on macOS, Firefox on
    Windows; non-Chromium profiles correctly omit Client Hints.
  - `providers/browser.py` — `BrowserProvider` Protocol. `StubBrowser`
    re-fetches via httpx (default). `BrowserlessProvider` posts to
    `/content` with `stealth=true&humanize=true&blockAds=true` and
    forwards the proxy URL so rendered traffic shares the residential
    IP. `LocalPlaywrightProvider` is a lazy-import escape hatch for
    gated live tests.
  - `agents/scraper.py` accepts optional `fingerprint=` / `session=`;
    when proxy is set, builds a per-request `httpx.AsyncClient(proxy=)`
    so the shared client's connection pool isn't reused.
  - `agents/graph.py::PipelineDeps` gained optional `browser`,
    `proxy_session`, `fingerprint` fields. The `fetch_headless` node now
    delegates to `BrowserProvider.render(...)` instead of a hardcoded
    stub.
  - `worker/runner.execute_job` mints one `ProxySession` per (tenant,
    job) and derives a `Fingerprint` from its `session_id`.
  - `worker/providers.build_run_deps` auto-selects:
    `SmartproxyProvider` when both `smartproxy_username` +
    `smartproxy_password` are set, else `MockProxy`; `BrowserlessProvider`
    when `browserless_token` is set, else `StubBrowser`.
  - 157 tests pass at **85% total coverage** (up from 84%). New tests:
    `test_proxy.py` (8), `test_fingerprint.py` (8), `test_browser.py` (8),
    `test_worker_providers.py` (7), plus +2 fingerprint tests in
    `test_scraper.py` and +2 in `test_config.py`. `ruff`, `ruff format
    --check`, `mypy --strict` all clean across 66 source files.
- All Phase 5 exit criteria from `docs/PLAN.md §Phase 5` met (except
  live deploy smoke — see Open items):
  - `core/cache.py` — `Cache` Protocol + `InMemoryCache` (lock-guarded
    dict with monotonic-time TTLs) + `RedisCache` (lazy `redis.asyncio`
    import, `decode_responses=True`, SETEX with min-1s clamp). Selector
    `build_cache(redis_url)` picks in-memory when URL is falsy.
  - `core/rate_limit.py` — `RateLimiter` Protocol + three impls:
    `NoopRateLimiter` (admits everything), `InMemoryRateLimiter`
    (asyncio-locked per-tenant token bucket), `RedisRateLimiter`
    (atomic Lua script `_REDIS_LUA` registered once via `EVALSHA`,
    bucket TTL = `capacity/refill + 60s`). `build_rate_limiter`
    selector: `per_minute<=0 -> Noop`, `redis_url -> Redis`, else
    `InMemory`.
  - `core/metrics.py` — private `CollectorRegistry` so tests stay
    isolated. Counters: `sentry_jobs_submitted_total{tenant_slug}`,
    `sentry_jobs_completed_total{status}`,
    `sentry_suppression_rejects_total{stage}`,
    `sentry_pii_redactions_total{category}`,
    `sentry_rate_limit_rejects_total{tenant_slug}`. Histograms:
    `sentry_job_duration_seconds{status}` (job-level wall clock),
    `sentry_pipeline_stage_duration_seconds{stage}`. Helper
    `time_stage(stage)` is a `contextmanager` that records on both
    success and exception. `render_metrics()` returns
    `(body, CONTENT_TYPE_LATEST)` for the FastAPI route.
  - `api/main.py` — lifespan now builds + tears down `cache` and
    `rate_limiter` on `app.state`. Mounts `GET /metrics` only when
    `metrics_enabled=True`. Honours `auto_create_tables=False` (prod)
    by skipping the `create_all` step so Alembic owns schema.
  - `api/dependencies.py` — `get_rate_limiter` + `enforce_rate_limit`
    (admits or raises `RateLimitedError(429)`). Suppression check
    runs *before* the rate limit so a suppressed-and-rate-limited
    caller still gets the 451 (better feedback, no info leak).
  - `api/routes/profiles.py::create_profile_job` — order of work is
    `auth -> suppression(check + audit + 451) -> rate_limit(429) ->
    enqueue + JOB_SUBMITTED_TOTAL`. GET / DELETE intentionally NOT
    rate-limited (cheap polls).
  - `core/errors.py::RateLimitedError` — `code=RATE_LIMITED`, `429`,
    `retryable=True`. Same envelope shape as every other domain error
    so clients catch on `error.code` not status.
  - `worker/runner.execute_job` — wraps each LangGraph stage in
    `time_stage(stage)`, records `JOB_DURATION_SECONDS` + bumps
    `JOB_COMPLETED_TOTAL{status}` on terminal transitions, increments
    `PII_REDACTION_TOTAL{category}` per redaction, and bumps
    `SUPPRESSION_REJECT_TOTAL{stage="post_extract"}` for the
    erasure-mid-flight branch.
  - `worker/arq_worker.py::redis_settings_from_env` now raises if
    `REDIS_URL` is unset (was silently using the SQLite default).
  - `core/config.py` — `redis_url: str | None = None` (was always-set);
    new `auto_create_tables`, `rate_limit_per_minute`,
    `rate_limit_burst`, `cache_serp_ttl_seconds`,
    `cache_profile_ttl_seconds`, `metrics_enabled` settings.
  - **Migrations** — `migrations/env.py` + first revision
    `70aeb72c1be2_phase4_baseline.py` capture all 5 tables (jobs,
    tenants, api_keys, suppressions, audit_entries). Alembic now
    owns prod schema; `alembic.ini` configured for async URLs.
  - **Deploy artefacts** — `Dockerfile` (multi-stage,
    `python:3.13-slim`, non-root uid 1001 user, single image used by
    both `api` and `worker` via CMD override), `docker-compose.yml`
    (Postgres + Redis + one-shot `migrate` service blocks `api` +
    `worker`), `fly.toml` (`api` + `worker` process groups, `[deploy]
    release_command = "alembic upgrade head"`, `[metrics]` for `/metrics`
    scrape, separate VM sizing per group).
  - **Runbook** — `docs/RUNBOOK.md` covers env tables, secret
    provisioning, migration generate/apply/rollback, day-2 ops
    (logs, metrics, tenant + key + suppression provisioning), scaling,
    and the 5xx / queue-backlog / 429 incident playbooks.
  - **Tests** — 4 new files:
    - `test_cache.py` (11): in-memory round-trip, TTL expiry, zero-TTL
      semantics, delete idempotency, overwrite resets TTL, concurrent
      writers, `build_cache` selector for None / "" / Redis URL,
      `RedisCache` constructor is connect-free.
    - `test_rate_limit.py` (10): Noop admits everything, in-memory
      admits up to burst then rejects, per-tenant isolation, refill
      over time, default burst is `2 * per_minute`, `per_minute=0`
      raises in both InMemory and Redis adapters, `build_rate_limiter`
      selector for all three branches.
    - `test_metrics.py` (5): `render_metrics` emits Prometheus text
      with HELP / TYPE comments, `time_stage` records on success and
      on exception (re-raises unchanged), `/metrics` mounted when
      enabled / 404 when disabled.
    - `test_rate_limit_api.py` (2): third POST returns
      429 + `RATE_LIMITED` envelope under `per_minute=1, burst=2`;
      unauthenticated requests don't drain the bucket (auth gate
      runs first).
  - **Phase 5 verification suite.** `ruff check`, `ruff format
    --check`, `mypy` (80 source files, two `from_url` calls
    annotated `# type: ignore[no-untyped-call]`), and `pytest` (220
    passed, +28 from Phase 4) all green.
- **Phase 5 design notes worth remembering.**
  - `migrations/versions/` is excluded from ruff in `pyproject.toml`;
    Alembic's auto-generated template doesn't follow our style and
    re-formatting it would diverge from upstream tooling.
  - `RedisRateLimiter._REDIS_LUA` is a single round-trip Lua script
    (refill → check → decrement) so the bucket math is atomic across
    replicas. Falling back to GETSET would race under concurrent
    requests from the same tenant.
  - The `/metrics` endpoint is **unauthenticated** by design —
    Prometheus scrapers don't carry per-tenant API keys. Network
    isolation (Fly internal network) is the gate.
  - We did NOT wire OpenTelemetry. The PLAN listed `opentelemetry-*`
    as a dep; on review it adds collector + exporter complexity that
    isn't needed yet. Prometheus + structured JSON logs cover the
    "what's happening" question in prod. Revisit when we want
    distributed tracing across the worker → upstream call graph.

## Open items

- Repo directory was renamed `/Users/aran/code/SentryAI` →
  `/Users/aran/code/SentryAI-Sales-Tool` between sessions; the user
  also nukes `.venv/` periodically. Recreate with
  `python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"`.
  CorpusName: `apantvaidya/SentryAI-Sales-Tool`. Branch: `scraper`.
- **Phase 5 live deploy is unproven.** The compose stack and `fly.toml`
  are wired but neither has been brought up end-to-end; the exit
  criterion ("p50 < 15s on 20-request synthetic load") still needs a
  staging run. Order to verify:
  1. `docker compose up --build` and POST a fixture build.
  2. `fly deploy` to a staging app, repeat the POST.
  3. Capture latency from `sentry_job_duration_seconds`.
- `LiteLLMProvider` (real LLM adapter) is wired but never exercised against
  a live API. Future work: an env-gated live call to confirm OpenAI
  structured-output works end-to-end.
- `SentenceTransformerEmbeddings` requires `pip install -e ".[ml]"` and
  has not been smoke-tested. Should run it once locally before
  flipping over from `HashEmbeddings` in production.
- `worker/arq_worker.py` is **not exercised by tests** — it's the
  production entry point invoked via `arq sentry_scraper_module.worker.
  arq_worker.WorkerSettings`. Functionally identical to the in-process
  queue path, but should get a Redis-backed smoke test before deploy.
- `worker/providers.py` is **now covered** by `test_worker_providers.py`
  (selection logic). Live calls against Smartproxy / Browserless are
  still gated — see the Phase 3 live integration test note in
  `docs/PLAN.md`.
- `BrowserlessProvider` and `SmartproxyProvider` are **untested against
  real services**. Need a one-shot live smoke before merging to prod:
  set `SMARTPROXY_USERNAME` + `SMARTPROXY_PASSWORD` + `BROWSERLESS_TOKEN`,
  run the API end-to-end against a known Cloudflare-protected URL,
  confirm `fetched_via='headless'` on the result.
- `LocalPlaywrightProvider` lazy-imports `playwright` — requires
  `pip install playwright && playwright install chromium` and is meant
  only for the gated live test. Not covered by unit tests.
- ~~Alembic migrations not wired yet~~ → **DONE in Phase 5.**
  Baseline revision `70aeb72c1be2_phase4_baseline.py` covers all 5
  tables; production sets `auto_create_tables=false` and runs
  `alembic upgrade head` on deploy.
- **PII categories are conservative regex-based.** `compliance/pii_filter`
  catches health / family / religion / government_id / financial_personal
  via curated keyword + pattern lists. False positives are acceptable
  (we'd rather drop a benign sentence than leak); false negatives are
  the real risk. When the LLM extractor changes shape (new fields), the
  filter MUST be re-audited — there's no automatic field discovery.
- **Suppression `target_hash` is one-way.** We can't list "who's been
  suppressed" for ops without a side channel, by design. An operator
  who needs to debug an erasure must re-hash the candidate identity
  with `hash_target(name, company)` and grep the table.
- **Erasure with `email` alone doesn't purge jobs.** The job table's
  `request` blob has `target_name` + `company_name`, never an email.
  Email erasure stores the hash so future POSTs that submit the *same*
  email-as-name are rejected, but historical jobs aren't matched. If
  PRD evolves to accept `email` in `ProfileRequest`, revisit this.
- CI workflow at `.github/workflows/ci.yml` has never run — first PR will
  exercise it.
- The local `.venv` exists at the repo root (gitignored). Use
  `.venv/bin/<tool>` for all commands until the user picks a different
  Python tool (uv, poetry, pyenv).

## Quick reference

```bash
# one-time setup (already done)
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
# optional, prod-only: real semantic embeddings
.venv/bin/pip install -e ".[ml]"

# verification suite
.venv/bin/ruff check .
.venv/bin/ruff format --check .
.venv/bin/mypy
.venv/bin/pytest --cov=sentry_scraper_module --cov-fail-under=70

# run the API
.venv/bin/uvicorn sentry_scraper_module.api.main:app --reload
curl http://127.0.0.1:8000/healthz

# Phase 1 fixture-driven CLI (FakeLLM, no API keys)
.venv/bin/python -m sentry_scraper_module.scripts.run_pipeline \
    --target-name "Jane Smith" \
    --company-name "Acme Corp" \
    --context-goal "developer tooling pitch" \
    --fixtures-dir tests/fixtures
# pass `--llm litellm` to route through the real provider
# (requires OPENAI_API_KEY / ANTHROPIC_API_KEY in env).

# Phase 2 — async-with-polling API (in-process queue by default)
export BOOTSTRAP_API_KEYS="acme:dev-key"
.venv/bin/uvicorn sentry_scraper_module.api.main:app --reload

curl -X POST http://127.0.0.1:8000/v1/profiles \
    -H "X-API-Key: dev-key" \
    -H "Content-Type: application/json" \
    -d '{"target_name":"Jane Smith","company_name":"Acme Corp"}'
# -> 202 {"job_id": "...", "status": "queued", "poll_url": "/v1/profiles/..."}

curl -H "X-API-Key: dev-key" http://127.0.0.1:8000/v1/profiles/<job_id>

# Phase 2 — production worker (requires Redis + Postgres reachable)
.venv/bin/arq sentry_scraper_module.worker.arq_worker.WorkerSettings

# Phase 4 — right-to-erasure
curl -X DELETE http://127.0.0.1:8000/v1/erasure \
    -H "X-API-Key: dev-key" \
    -H "Content-Type: application/json" \
    -d '{"target_name":"Jane Smith","company_name":"Acme Corp","reason":"GDPR"}'
# -> 200 {"accepted":true,"target_hash":"<sha256-hex>","purged_job_count":N}
# Subsequent POSTs for the same target return 451 SUPPRESSED.
```

## Resolved decisions (canonical copy in `docs/DESIGN.md §12`)

| #  | Topic           | Decision                                                                |
| -- | --------------- | ----------------------------------------------------------------------- |
| 1  | Hosting         | Fly.io primary; Cloud Run secondary.                                    |
| 2  | SERP            | Serper.dev.                                                             |
| 3  | LLM             | LiteLLM; primary `openai/gpt-4o-mini`, fallback `claude-3-5-haiku`.     |
| 4  | Proxy           | Smartproxy residential, session-sticky.                                 |
| 5  | Headless        | Managed Browserless.io; local Playwright in tests only.                 |
| 6  | API mode        | Async with polling.                                                     |
| 7  | Auth            | Static API keys per tenant, hashed at rest.                             |
| 8  | Persistence     | Postgres from day one (SQLModel + Alembic + asyncpg).                   |
| 9  | Tenancy         | Multi-tenant; every row carries `tenant_id`.                            |
| 10 | Naming          | SentryScraperModule (product), `sentry_scraper_module` (Python package). |

## File map (current)

```
.env.example
.github/workflows/ci.yml
.gitignore
README.md
context.md                                 # this file
pyproject.toml
docs/{PRD,DESIGN,PLAN}.md
src/sentry_scraper_module/
  __init__.py                              # __version__ = "0.0.1"
  agents/
    __init__.py
    types.py                               # FetchedPage, DistilledPage, Chunk
    distiller.py                           # trafilatura → DistilledPage
    chunker.py                             # split + embed + cosine top-k
    extractor.py                           # SYSTEM_PROMPT + extract_profile
    confidence.py                          # presence + authority blend
  api/
    __init__.py
    main.py                                # create_app() + /healthz + handlers
    schemas.py                             # ProfileRequest, Profile, ProfileResult
  core/
    __init__.py
    config.py                              # Settings (pydantic-settings)
    logging.py                             # structlog (console / JSON modes)
    errors.py                              # ProfilingError hierarchy
  providers/
    __init__.py
    llm.py                                 # LLMProvider, LiteLLMProvider, FakeLLM
    embeddings.py                          # HashEmbeddings, SentenceTransformerEmbeddings
  scripts/
    __init__.py
    run_pipeline.py                        # Phase 1 fixture CLI
  agents/                                  # (Phase 2 additions)
    state.py                               # ProfileState TypedDict + initial_state
    planner.py                             # build_queries, merge_and_rank, plan_candidates
    scraper.py                             # fetch_static{,_many}, fetch_headless stub, detect_challenge
    graph.py                               # PipelineDeps + LangGraph wiring + run_profile_pipeline
  api/                                     # (Phase 2 additions)
    auth.py                                # require_tenant (hashed-keys-first + bootstrap fallback)
    dependencies.py                        # get_session, get_queue
    queue.py                               # JobQueue Protocol, InProcessQueue, ArqQueue
    routes/
      __init__.py
      profiles.py                          # POST/GET/DELETE /v1/profiles (+ suppression check)
      erasure.py                           # DELETE /v1/erasure   (Phase 4)
  compliance/                              # (Phase 4 additions)
    __init__.py
    suppression.py                         # check_suppression(session, request)
    pii_filter.py                          # redact_pii(profile) + Redaction
    audit.py                               # log_pii_redaction / log_suppression_reject / log_erasure_request
  persistence/
    __init__.py
    database.py                            # async engine, session factory, create_all
    models.py                              # Tenant, Job, ApiKey, Suppression, AuditEntry (+ hash helpers)
    repository.py                          # CRUD: tenants, jobs, api_keys, suppressions, audit
  providers/                               # (Phase 3 additions)
    proxy.py                               # ProxySession, MockProxy, SmartproxyProvider
    browser.py                             # BrowserProvider Protocol + Stub / Browserless / LocalPlaywright
  core/                                    # (Phase 3 additions)
    fingerprint.py                         # build_fingerprint(session_id) + Fingerprint.for_url
  worker/
    __init__.py
    runner.py                              # execute_job (+ post-extract suppression re-check + PII redaction)
    providers.py                           # build_run_deps (Fakes ↔ real adapters + proxy/browser selectors)
    arq_worker.py                          # arq WorkerSettings + run_profile_job
tests/
  __init__.py
  conftest.py                              # fixtures_dir, fixture_html, hash_embeddings
  fixtures/
    linkedin_profile.html
    company_about.html
    news_article.html
    empty_challenge.html
  test_chunker.py
  test_confidence.py
  test_distiller.py
  test_embeddings.py
  test_errors.py
  test_extractor.py
  test_healthz.py
  test_llm.py
  test_pipeline_end_to_end.py
  test_schemas.py
  # Phase 2 additions
  test_persistence.py                      # tenants + jobs CRUD
  test_serp.py                             # FakeSerp + SerperProvider parsing
  test_planner.py                          # build_queries + merge_and_rank
  test_scraper.py                          # fetch_static + needs_escalation
  test_graph.py                            # full LangGraph happy path + escalation
  test_config.py                           # Settings.parsed_api_keys + validator
  test_queue.py                            # InProcessQueue
  test_runner.py                           # execute_job (+ suppression mid-flight + PII redaction)
  test_routes.py                           # full HTTP round-trip (auth, lifecycle, cross-tenant)
  # Phase 3 additions
  test_proxy.py                            # MockProxy + SmartproxyProvider URL/determinism
  test_fingerprint.py                      # build_fingerprint coherence + Fingerprint.for_url
  test_browser.py                          # StubBrowser + BrowserlessProvider URL construction
  test_worker_providers.py                 # build_run_deps proxy/browser selection matrix
  # Phase 4 additions
  test_compliance.py                       # hashing + ApiKey CRUD + suppression + PII + audit (unit)
  test_compliance_api.py                   # HTTP-level 451 / erasure / hashed-key auth (integration)
```

## Gotchas worth remembering

- **structlog + `PrintLoggerFactory`:** do NOT include
  `structlog.stdlib.add_logger_name` in the processor list — `PrintLogger`
  has no `.name` and the processor will raise `AttributeError` from inside
  exception handlers, masking the real exception with a 500. Use
  `structlog.processors.add_log_level` instead.
- **structlog `format_exc_info` vs `ConsoleRenderer`:** `ConsoleRenderer`
  formats `exc_info` itself; if `format_exc_info` is in the processor list
  before it, structlog emits a `UserWarning` (`"Remove `format_exc_info`
  from your processor chain ..."`). With `filterwarnings = ["error"]` this
  surfaces as a 500 + empty body from inside the exception handler. Solution
  in `core/logging.py`: only include `format_exc_info` when the renderer is
  `JSONRenderer`.
- **FastAPI exception handlers + mypy strict:** type the handler's `exc`
  parameter as `Exception` and `assert isinstance(exc, ProfilingError)`
  inside. Otherwise mypy complains because Starlette's registered handler
  signature is `(Request, Exception)`.
- **`pytest filterwarnings = ["error"]`** is currently on. If a Phase 1+
  dependency emits deprecation warnings during tests, expect surprise
  failures — relax with a targeted `ignore::DeprecationWarning:<module>`
  rather than removing the strict default.
- **OpenAI strict JSON-Schema:** Pydantic's `model_json_schema()` doesn't
  mark all properties required nor set `additionalProperties=false`, both
  of which the `response_format=json_schema strict=true` mode demands.
  `providers/llm.py::strict_json_schema` walks the schema and promotes
  every object node in place. Use that helper, never the raw Pydantic
  output, for any LLM call expecting structured output.
- **`sentence-transformers` is in the `[ml]` extra**, not the core deps.
  `default_embeddings()` falls back to `HashEmbeddings` when the import
  fails, so dev/CI never need to install the heavy ML stack. Production
  must `pip install -e ".[ml]"` to get real semantic ranking.
- **`HashEmbeddings`** is L2-normalised; chunker treats `chunk @ query`
  as cosine similarity directly. If you add another embedding adapter,
  it MUST also L2-normalise (`SentenceTransformerEmbeddings` does this via
  `normalize_embeddings=True`).
- **LangGraph state merging:** drive the compiled graph with `ainvoke`,
  not by accumulating `astream` updates yourself. With `ainvoke` LangGraph
  applies the `Annotated[..., operator.add]` reducers on `fetched` /
  `errors` correctly; `astream` updates yield each node's *partial* dict,
  and naive `dict.update` clobbers the reducer-merged list (e.g. headless
  retry replacing the static fetch row instead of appending). See
  `agents/graph.py::run_profile_pipeline`.
- **Stage callback lives on `PipelineDeps`, not the runner:** the
  `stage_callback` is a property of the dependency bundle, so each node
  can `await deps.stage_callback(name)` at the *start* of its own work.
  Putting it on the runner instead means it can only fire *after* a node
  finishes — which loses the "queued/running/<stage>" granularity the
  polling API needs.
- **`SQLModel.metadata.create_all` is dialect-neutral:** the same call
  works against `sqlite+aiosqlite:///:memory:` (tests) and Postgres (prod).
  Don't add Postgres-only `Column` types (`JSONB`, `ARRAY`) without a
  conditional — keep `JSON` so SQLite tests stay fast.
- **Worker terminal-state guard:** `execute_job` first checks if the row
  is already in `done|failed|cancelled` and returns. This protects against
  duplicate enqueues (arq retry, or accidental double-POST) and against
  the `DELETE` race where a user cancels a job that the worker is
  already finishing. Always preserve the *first* terminal write.
- **Post-success cleanup must not demote `done` to `failed`:** the runner
  splits "produce result" from "persist done" so an exception inside the
  deps context-manager `__aexit__` (e.g. `httpx.AsyncClient.close`) can't
  reroute a successful job into the `mark_failed` branch. Mirror this
  pattern if you add new resource scopes.
- **In-memory SQLite + many concurrent sessions:** SQLAlchemy's default
  pool is shared across `async_sessionmaker` calls bound to the same
  `AsyncEngine`, so multiple concurrent sessions see the same
  `:memory:` DB. If you ever swap in `NullPool` or build the engine
  per-task, this breaks — use a temp file DSN instead.
- **FastAPI `Depends(...)` pattern flagged by ruff B008:** allowed in
  `api/routes/*` and `api/auth.py` via per-file ignore. Do not silence
  B008 globally.
- **`httpx.AsyncClient` `proxy=` is constructor-only in 0.27:** there's
  no per-request proxy. `fetch_static` builds a short-lived
  `httpx.AsyncClient(proxy=session.proxy_url, timeout=...)` when a
  session URL is set, rather than the shared client. Don't try to plumb
  a `proxy=` kwarg into `.get()` — it's silently dropped on older
  httpx, type-rejected on 0.27+.
- **`**kwargs: dict[str, object]` doesn't unpack into httpx APIs under
  mypy strict:** every httpx parameter is individually typed and `object`
  isn't compatible. Pass kwargs explicitly (`headers=...`,
  `timeout=...`, `follow_redirects=...`).
- **Test handler discrimination for static-vs-headless:** the Phase 3
  stub browser fetches with the *same* fingerprint headers as the
  static path. Tests that vary response between the two MUST
  discriminate by attempt count, not UA substring. See
  `tests/test_graph.py::_serve_fixtures`.
- **Partial proxy credentials → MockProxy, not crash:** in
  `worker/providers._build_proxy`, only-username or only-password
  intentionally falls back to `MockProxy`. Half-configured Smartproxy
  would silently fail at the first real fetch with a 407, which is
  much harder to debug than "proxy was off".
- **`fingerprint` + `proxy_session` propagate together:** the runner
  derives the fingerprint from the proxy session's `session_id`, so a
  caller that hand-builds a `PipelineDeps` should either set both or
  set neither. Setting only `proxy_session` is fine (graph derives
  fingerprint); setting only `fingerprint` is fine too (graph uses a
  no-proxy default session). Setting neither uses the in-scraper
  `_FALLBACK_FINGERPRINT` keyed on `"default"`.
- **Suppression is checked twice — accept *and* post-extract.** The
  POST handler rejects suppressed targets with 451 before any fetch.
  The worker re-checks after `extract` so an erasure that lands while
  the pipeline is running still drops the result. The mid-flight
  variant emits `SuppressedTargetError` from inside the try-block, so
  it lands in `mark_failed` (not `mark_done`) — that's the expected
  shape: a suppressed target leaves a *failed* row, never a `done`
  row with empty content. See `worker/runner.execute_job` after the
  pipeline `await`.
- **Hashed API keys are tried before the bootstrap mapping.** If the
  same plaintext key resolves under both paths, the hashed-table
  tenant wins. Test-time pitfall: provisioning a hashed row with
  plaintext `"test-api-key"` while `BOOTSTRAP_API_KEYS` also maps
  `acme:test-api-key` means subsequent requests land on the hashed
  tenant, not `acme`. See `api/auth.require_tenant`.
- **`purge_jobs_for_target` is a Python-side filter, not a SQL DELETE.**
  We hash `(target_name, company_name)` and walk every job row,
  comparing per-row. SQLite + Postgres handle JSON `->>` differently
  and the request shape can evolve, so portability + future-proofing
  beat throughput here. Erasure is admin-tier rare — fine.
- **PII redaction works in-place on the LLM output, before persist.**
  The runner stores the *cleaned* `ProfileResult`, not the raw one.
  That means `Job.result` is forensically safe; the only place raw
  PII ever existed was the in-memory `final["profile"]` returned by
  the graph. If you ever expose raw extractor output (e.g. for
  debugging endpoints), it MUST be re-redacted at the boundary.
- **Audit rows are append-only and survive erasure.** `purge_jobs_
  for_target` deletes `jobs`, not `audit_entries`. Operators querying
  audit history for a suppressed target use `hash_target(name, comp)`
  to find the corresponding `suppression_reject` / `erasure_request`
  rows, even after the job is gone. This is deliberate per
  `docs/DESIGN.md §7.3`.

---

## Session log

### 2026-05-23 — Phase 0 (skeleton)

- Captured PRD verbatim into `docs/PRD.md`.
- Wrote `docs/DESIGN.md` (architecture, LangGraph nodes, anti-bot,
  compliance, error model, observability).
- Wrote `docs/PLAN.md` (six phases with exit criteria + open decisions).
- User picked **async with polling**; updated DESIGN §3.4 (job lifecycle)
  and PLAN Phase 2 to introduce the `jobs` table + `arq` worker.
- User resolved remaining 9 decisions (Fly.io, Serper.dev, LiteLLM,
  Smartproxy, Browserless, static API keys, Postgres, multi-tenant,
  rename to `SentryScraperModule`); reflected in DESIGN §12 + PLAN.
- Scaffolded Phase 0:
  - `pyproject.toml` (hatchling, fastapi, uvicorn, pydantic v2,
    pydantic-settings, structlog; dev: ruff, mypy, pytest+asyncio+cov, httpx).
  - `.gitignore`, `.env.example`, `README.md`.
  - `src/sentry_scraper_module/__init__.py` (`__version__`).
  - `core/config.py` (Settings via pydantic-settings, `get_settings()`
    cached).
  - `core/logging.py` (structlog, idempotent `configure_logging`).
  - `core/errors.py` (`ProfilingError` base + 7 subclasses + `ErrorBody`).
  - `api/main.py` (`create_app(settings=None)`, `/healthz`, exception
    handlers for `ProfilingError` and catch-all `Exception`).
  - `tests/test_healthz.py`, `tests/test_errors.py`.
  - `.github/workflows/ci.yml` (ruff + mypy + pytest, 70% coverage gate).
- Caught and fixed a logging bug: the structlog `add_logger_name` processor
  is incompatible with `PrintLoggerFactory`; tracked in **Gotchas** above.
- Verified locally: ruff/format/mypy clean, 10/10 tests pass at 96%
  coverage, uvicorn boots, `curl /healthz` returns the expected JSON.
- Killed local uvicorn after verification (port 8765 freed).

### 2026-05-23 — Phase 1 (core pipeline)

- Added Phase 1 deps to `pyproject.toml`: `litellm`, `trafilatura`,
  `langchain-text-splitters`, `numpy`; introduced optional `[ml]` extra for
  `sentence-transformers`. Added `[[tool.mypy.overrides]]` entry to suppress
  the missing-stub error for `sentence_transformers` since CI doesn't
  install the `[ml]` extra.
- `api/schemas.py`: `ProfileRequest` (`extra="forbid"`, `min_length=1` on
  `target_name`), `Profile` + four sub-sections with empty-string / empty-
  list defaults, `BuildMetadata`, `ProfileResult`.
- `agents/types.py`: internal `FetchedPage`, `DistilledPage`, `Chunk`.
- `providers/llm.py`: `LLMProvider` Protocol, `LiteLLMProvider` (lazy import
  of `litellm.acompletion`, fallback chain via `fallbacks=`), `FakeLLM` for
  tests, and `strict_json_schema()` helper to make Pydantic schemas
  OpenAI-strict-mode compatible.
- `providers/embeddings.py`: `EmbeddingProvider` Protocol, deterministic
  `HashEmbeddings` (token-hash bag-of-features, L2-normalised),
  lazy `SentenceTransformerEmbeddings`, `default_embeddings()` factory.
- `agents/distiller.py`: trafilatura-backed `distill()` returning
  `DistilledPage` or `None` (latter for empty/challenge pages and pages
  under `MIN_WORDS = 50`).
- `agents/chunker.py`: `select_relevant_chunks()` — short pages pass
  through whole, long pages are split with
  `RecursiveCharacterTextSplitter`, then cosine-ranked against a query
  string via the embedding provider; top-`k` survive.
- `agents/extractor.py`: `SYSTEM_PROMPT` enforcing B2B-only,
  no-speculation, grounded cost_metrics, derivable how_we_benefit_them;
  `extract_profile()` is a single async LLM call;
  `render_user_prompt()` is exposed for prompt inspection in tests.
- `agents/confidence.py`: `score_authority()` (tiered weights for
  LinkedIn / GitHub / Wikipedia / news / blog / default) and
  `compute_confidence()` (0.6 × presence + 0.4 × authority, clamped,
  low-flag below 0.4).
- Test fixtures: four synthetic HTML pages
  (`linkedin_profile`, `company_about`, `news_article`, `empty_challenge`)
  containing a fictional "Jane Smith, VP of Engineering at Acme Corp".
- New unit tests across 8 files (57 tests) plus `test_pipeline_end_to_end.py`
  (1 test). Combined with Phase 0's 10 tests = **67 tests, all green**.
- Hit and fixed the `format_exc_info` + `ConsoleRenderer` warning
  interaction (see Gotchas). Reproduction surfaced when the same
  `test_unhandled_exception` test regressed under the larger test suite.
- `scripts/run_pipeline.py`: CLI driver wired against `default_embeddings()`
  and `FakeLLM` by default. Verified with
  `python -m sentry_scraper_module.scripts.run_pipeline --target-name "Jane
  Smith" --company-name "Acme Corp" --fixtures-dir tests/fixtures` — emits
  a valid `ProfileResult` JSON; challenge fixture correctly dropped;
  confidence 0.45 for the skeletal canned profile.
- Phase 1 verification suite: `ruff check`, `ruff format --check`, `mypy`
  (strict, 32 source files), `pytest` (67 passed) all green. Coverage on
  `agents/` + `providers/` combined: **90%** (gate: 80%).

### 2026-05-23 — Phase 2 (orchestration + async API)

- **Persistence (Phase 2A).** Added Phase 2 deps to `pyproject.toml`:
  `langgraph`, `sqlmodel`, `sqlalchemy[asyncio]`, `aiosqlite`, `asyncpg`,
  `httpx[http2]`, `arq`. Built `persistence/database.py` (async engine,
  session factory, `create_all`), `persistence/models.py`
  (`Tenant`, `Job`, `JobStatus` as `StrEnum` to dodge ruff UP042),
  and `persistence/repository.py` (CRUD + lifecycle helpers:
  `enqueue_job`, `mark_running`, `update_stage`, `mark_done`,
  `mark_failed`, `cancel_job`). 11 tests in `test_persistence.py`,
  green against in-memory SQLite.
- **Pipeline orchestration (Phase 2B).** Added the multi-agent core:
  - `agents/state.py` — `ProfileState` `TypedDict` (`total=True` for
    LangGraph's typing stubs) with `Annotated[..., operator.add]` on
    `fetched` and `errors` so concurrent appends merge correctly.
  - `providers/serp.py` — `SerpProvider` Protocol + `FakeSerp` +
    `SerperProvider` (POST `https://google.serper.dev/search`).
    Defensive parsing: malformed `organic` entries are skipped, not
    raised.
  - `agents/planner.py` — `build_queries` / `merge_and_rank` /
    `plan_candidates`. Authority tier fed forward into ranking so
    LinkedIn / Wikipedia win ties.
  - `agents/scraper.py` — `fetch_static{,_many}` (httpx, byte-cap +
    timeout), `detect_challenge` / `needs_escalation` heuristics on
    status codes + body markers, and `fetch_headless` **stub** that
    just rebrands the static body (Phase 3 will wire Browserless).
  - `agents/graph.py` — `PipelineDeps` dataclass bundling
    `http_client`, `serp`, `llm`, `embeddings`, and `stage_callback`;
    seven nodes (`plan`, `fetch_static`, `fetch_headless`, `distill`,
    `chunk`, `extract`, `finalize`); conditional edge after
    `fetch_static` reroutes to `fetch_headless` when escalation flags;
    runner uses `compiled.ainvoke` so reducers fire (see Gotchas).
  - 16 unit tests across `test_serp.py`, `test_planner.py`,
    `test_scraper.py`, plus 3 end-to-end tests in `test_graph.py`
    (happy path, escalation merges static + headless retries, no-
    candidate edge case).
- **API + auth (Phase 2C).**
  - Extended `Settings` with `database_url`, `redis_url`, and
    `bootstrap_api_keys` (`slug:key,...`). Validator rejects malformed
    entries at startup; `parsed_api_keys()` returns the
    `{plaintext_key: tenant_slug}` lookup.
  - `api/auth.py::require_tenant` resolves `X-API-Key` → slug → tenant
    row; missing/invalid/unprovisioned all surface
    `UNAUTHORIZED` (401).
  - `api/dependencies.py` — `get_session` (request-scoped, commits/
    rolls back) and `get_queue` (pulls from `app.state.queue`).
  - `api/queue.py` — `JobQueue` Protocol with `InProcessQueue`
    (asyncio-task fan-out, used by tests + dev) and `ArqQueue`
    (production, lazy Redis pool). `wait_idle()` test helper.
  - `api/routes/profiles.py` — `POST` enqueues + returns 202
    `JobAccepted`; `GET` returns `JobStatusResponse` with
    embedded `ProfileResult` on done; `DELETE` is idempotent and
    returns the post-cancel status. Cross-tenant access is masked as
    `INVALID_REQUEST` (400) so existence never leaks.
  - `api/main.py::create_app(settings, queue_factory=...)` — lifespan
    builds engine, runs `create_all`, ensures default tenant + every
    bootstrap-key tenant, builds the queue (default = in-process
    handler that `await execute_job(...)`).
- **Worker (Phase 2D).**
  - `worker/runner.py::execute_job(job_id, session_factory,
    deps_factory)` — terminal-state guard, `mark_running`, drives the
    LangGraph pipeline with a per-node `stage_callback` that persists
    `update_stage`, then writes `mark_done` *or* `mark_failed`.
    Wraps unexpected exceptions in `InternalError` so the stored
    error envelope shape stays uniform with the API surface.
    Result/error logic is split into compute-then-persist phases so a
    post-success cleanup error can't demote a `done` job (see
    Gotchas).
  - `worker/providers.py::build_run_deps(settings)` — async context
    manager that yields `RunDeps` with a managed `httpx.AsyncClient`.
    Picks `SerperProvider` / `LiteLLMProvider` when keys are present,
    falls back to `FakeSerp` / `FakeLLM(empty Profile)` otherwise.
  - `worker/arq_worker.py::WorkerSettings` — module-level entry point
    for `arq sentry_scraper_module.worker.arq_worker.WorkerSettings`.
    `startup` builds engine + session factory; `run_profile_job`
    delegates straight to `execute_job`.
- **Tests added (Phase 2 deltas).** `test_config.py` (7),
  `test_queue.py` (3), `test_runner.py` (3, success / wrap-exception /
  terminal-skip), `test_routes.py` (6, full HTTP round-trip with
  `httpx.ASGITransport` + in-process queue + `MockTransport`).
- **Lint / type fixes encountered.**
  - Added `[tool.ruff.lint.per-file-ignores]` for FastAPI's
    `Depends(...)` pattern (B008) and arq's class-attribute
    `WorkerSettings.functions` (RUF012).
  - Added `[[tool.mypy.overrides]]` for `sentry_scraper_module.agents.
    graph` to silence `arg-type` / `call-overload` from LangGraph's
    `StateGraph` generics.
- **Phase 2 verification suite.** `.venv/bin/ruff check .`,
  `ruff format --check .`, `mypy` (strict, 59 source files), and
  `pytest` (123 passed) all green. `pytest --cov`: **84% total**;
  every module ≥ 67% except the production-only entry points
  (`worker/arq_worker.py` 0%, `worker/providers.py` 57%) which are
  intentionally not unit-tested — they need a Redis-backed smoke test
  before deploy.
- **Manual smoke — DONE.** Booted uvicorn with
  `DATABASE_URL=sqlite+aiosqlite:///./smoke.db
  BOOTSTRAP_API_KEYS=acme:smoke-key`. Verified:
  - `GET /healthz` → 200 `{ok: true, version, env}`.
  - `POST /v1/profiles` without key → 401 `UNAUTHORIZED`.
  - `POST /v1/profiles` with key → 202 `{job_id, status:queued, poll_url}`.
  - `GET /v1/profiles/<id>` → 200 status `done` in <1s (in-process queue).
  - `DELETE /v1/profiles/<id>` after done → 200 still `done` (idempotent).
  - `GET /v1/profiles/<missing-uuid>` → 400 `INVALID_REQUEST`.
  - Structured logs in `console` mode show
    `startup`, `worker_job_started`, `worker_job_done`, and
    `profiling_error` events with `code` + `path` fields.
  Empty `Profile` and `confidence=0.0` are expected without
  `SERPER_API_KEY` (FakeSerp returns no candidates → no fetches).

### 2026-05-24 — Phase 3 (anti-bot infra)

- **`providers/proxy.py`.** Introduced `ProxySession` (frozen dataclass:
  `session_id`, `proxy_url|None`), `ProxyProvider` Protocol with
  `session(*, tenant_id, job_id) -> ProxySession`. `MockProxy` returns
  `proxy_url=None` and records calls (testing). `SmartproxyProvider`
  builds `http://USERNAME-session-<id>:PASSWORD@gate.smartproxy.com:7000`
  with `_derive_session_id = sha256(tenant:job)[:16]`.
- **`core/fingerprint.py`.** Curated four browser profiles
  (chrome-mac, chrome-windows, safari-mac, firefox-windows). Chrome
  variants carry mutually-consistent `sec-ch-ua{,-mobile,-platform}`;
  Safari + Firefox correctly omit Client Hints. `build_fingerprint`
  seeds `random.Random(session_id)`, so the same session always emits
  the same headers. `Fingerprint.for_url(url)` adds a per-request
  `Referer` without mutating the frozen base.
- **`providers/browser.py`.**
  - `StubBrowser` — default; re-fetches via the shared `httpx.AsyncClient`
    using the fingerprint headers; tags `fetched_via='headless'`.
  - `BrowserlessProvider` — `POST /content?token=...&stealth=true&
    humanize=true&blockAds=true&proxy=<url>` with the fingerprint
    headers in the request body. Owns its `httpx.AsyncClient` if none
    is injected. Forwards the proxy URL when the session has one so
    rendered traffic stays on the same residential IP.
  - `LocalPlaywrightProvider` — lazy-imports `playwright.async_api`;
    only used by the gated live test (`BROWSER_PROVIDER=local`).
- **`agents/scraper.py`.** Removed `fetch_headless` (its job belongs to
  `BrowserProvider`). `fetch_static{,_many}` accept optional
  `fingerprint=` and `session=`. When `session.proxy_url` is set, the
  fetch opens its own short-lived `httpx.AsyncClient(proxy=...)` instead
  of reusing the shared client's pool (httpx 0.27 only takes `proxy=`
  on client construction, not per-request).
- **`agents/graph.py`.** `PipelineDeps` gained optional `browser`,
  `proxy_session`, `fingerprint`. `_make_fetch_headless_node` now
  resolves: `deps.browser or StubBrowser(...)`,
  `deps.proxy_session or ProxySession("default", None)`, and a
  fingerprint derived from `session_id` when only the session was
  supplied. Static and headless paths therefore share one fingerprint
  for the whole job.
- **`worker/runner.execute_job`.** After loading the job (and reading
  `tenant_id`), mints `proxy_session = (deps.proxy or MockProxy()).
  session(tenant_id, job_id)`, derives `fingerprint = build_fingerprint
  (session.session_id)`, then plugs both into `PipelineDeps`. Existing
  tests cover this path via the persistence layer's real tenant IDs.
- **`worker/providers.build_run_deps`.** Two new selectors:
  `_build_proxy(settings)` — `SmartproxyProvider` iff *both* username +
  password are set (partial creds intentionally fall back to MockProxy
  to avoid silent misconfiguration), and `_build_browser(settings,
  client)` — `BrowserlessProvider` iff `browserless_token` is set,
  else `StubBrowser`.
- **`core/config.Settings`** gained `smartproxy_username`,
  `smartproxy_password`, `browserless_token` (all `str | None`,
  default `None`). No validators — adapters validate their own inputs.
- **Tests added.** `test_proxy.py` (8: MockProxy + Smartproxy URL
  format, determinism, custom host/port, rejection of empty creds),
  `test_fingerprint.py` (8: determinism, statistical rotation,
  required-headers, Chrome platform-match invariant, Safari/Firefox
  no-Client-Hints invariant, frozen-dataclass referer injection),
  `test_browser.py` (8: StubBrowser headers + transport errors,
  Browserless URL construction with/without proxy param, timeout +
  HTTP errors), `test_worker_providers.py` (7: every credential
  combination → correct provider class; `httpx.AsyncClient` closed on
  context exit), plus +2 in `test_scraper.py` (fingerprint header
  propagation, default fallback) and +2 in `test_config.py`
  (Phase 3 fields default to None / load from kwargs).
- **Test handler change in `test_graph.py`.** Replaced UA-substring
  discrimination (`"Headless" in ua`) with attempt-count tracking,
  because the Phase 3 stub browser uses the same fingerprinted headers
  as the static fetcher. Cloudflare-style 503 is now returned on
  *attempt 1* per URL in `challenge_urls`, canned body on subsequent
  attempts. Behaviour for the test is identical, but the mechanism is
  no longer entangled with the headless UA string.
- **Phase 3 verification suite.** `ruff check`, `ruff format --check`,
  `mypy --strict` (66 source files), and `pytest` (157 passed) all
  green. `pytest --cov`: **85% total** (up from 84%). Gaps:
  `providers/browser.py` 70% (LocalPlaywrightProvider lazy-imports
  Playwright, not installed in CI), `worker/arq_worker.py` 0% (prod
  entry point), `persistence/database.py` 67% (real-DSN branches).
- **Live integration test deferred.** Per `docs/PLAN.md §Phase 3`, the
  end-to-end run against a Cloudflare-protected URL through real
  Smartproxy + Browserless is intentionally gated and is **not part of
  the CI gate**. Will be exercised once Phase 5 stands up the deploy
  pipeline and we can run it inside a Fly machine with secrets.

### 2026-05-24 — Phase 4 (compliance + hashed API keys)

- **Schema (Phase 4A).** Added three tables to
  `persistence/models.py`: `ApiKey` (sha256 `key_hash`, `label`,
  `last_used_at`, `revoked_at`), `Suppression` (sha256 `target_hash`,
  `reason`), `AuditEntry` (nullable `tenant_id` + `job_id`, JSON
  `payload`, `event_type` indexed). Introduced module-level helpers
  `hash_api_key(plaintext)` and `hash_target(name, company)` —
  `hash_target` lower-cases + trims so casing / whitespace can't slip
  a suppressed identity past the check.
- **Repository (Phase 4B).** Extended `persistence/repository.py`
  with `upsert_tenant`, `create_api_key`, `find_tenant_by_api_key`
  (skips revoked rows, bumps `last_used_at`), `revoke_api_key`,
  `add_suppression` (idempotent), `is_suppressed`,
  `purge_jobs_for_target` (Python-side filter — SQLite + Postgres
  JSON dialect parity), `record_audit_entry`, `list_audit_entries`.
- **`compliance/` package (Phase 4C).**
  - `suppression.py` — `SuppressionCheck` dataclass + thin
    `check_suppression(session, request)` wrapper used by both POST
    and the worker.
  - `pii_filter.py` — `redact_pii(profile) -> (cleaned, redactions)`
    walks every `Profile` string + list-of-string field; five regex
    categories (`health`, `family`, `religion`, `government_id`,
    `financial_personal`). List items containing PII are dropped
    whole; scalar matches get an inline `[redacted:<cat>]` marker.
  - `audit.py` — typed helpers `log_pii_redaction`,
    `log_suppression_reject`, `log_erasure_request` + `EVENT_*`
    constants so `event_type` strings stay consistent.
- **Auth (Phase 4D).** Refactored `api/auth.require_tenant` to try
  the hashed `api_keys` table first (Phase 4 path) and fall back to
  the `BOOTSTRAP_API_KEYS` mapping (Phase 2 dev path) on miss.
  Revoked rows return 401 just like unknown keys.
- **POST suppression (Phase 4E).**
  `api/routes/profiles.create_profile_job` calls
  `check_suppression` before `enqueue_job`. Hits raise
  `SuppressedTargetError` (451) and write an audit row tagged
  `stage="accept"`. The job table never sees a suppressed request.
- **Worker post-extract (Phase 4F).** `worker/runner.execute_job`
  runs a second `check_suppression` after the pipeline returns,
  inside the `try` block. Mid-flight suppression → `SuppressedTargetError`
  bubbles to `mark_failed (code=SUPPRESSED)`, no `mark_done` row.
  Clean hits run through `redact_pii`; redactions are persisted to
  `audit_entries` and the *cleaned* `ProfileResult` is what
  `mark_done` writes — `Job.result` never contains raw PII.
- **Erasure (Phase 4G).** New `api/routes/erasure.py` registers
  `DELETE /v1/erasure`. Accepts `{target_name, company_name?, reason?}`
  *or* `{email}`. Suppression rows are added; for the
  `target_name` variant `purge_jobs_for_target` deletes matching
  jobs; both variants log an `erasure_request` audit row.
  Returns `{accepted, target_hash, purged_job_count}`.
- **Tests added (Phase 4 deltas).** `test_compliance.py` (21:
  hashing helpers, `ApiKey` CRUD including revocation, suppression
  idempotency + canonical matching, PII filter across all five
  categories + dotted field paths, audit helpers + their no-op
  branches, `purge_jobs_for_target`). `test_compliance_api.py`
  (12: HTTP-level suppression-then-451, audit row written on reject,
  non-suppressed still 202, erasure-blocks-future-POST, erasure
  purges existing jobs, email-only erasure, no-identity 400,
  unauthenticated erasure 401, hashed-key auth happy path, revoked
  hashed key 401, hashed wins over bootstrap, dirty-LLM PII
  redaction round-trip with audit row). `test_runner.py` gained two
  tests (mid-flight suppression → failed, dirty profile → cleaned
  result + audit row).
- **Lint / type fixes encountered.** Ruff caught one import-sorting
  case in `test_compliance.py` after I added the new repository
  exports; `ruff --fix` resolved it. `ruff format` rewrapped one
  long line in `compliance/pii_filter.py`. `mypy --strict` passed
  on first run after I tightened `_scan`'s return type to
  `tuple[str, list[Redaction]]`.
- **Phase 4 verification suite.** `ruff check`, `ruff format --check`,
  `mypy --strict` (73 source files), and `pytest` (192 passed) all
  green. `pytest --cov`: **86% total** (up from 85%). Gaps:
  `api/auth.py` 60% (bootstrap-fallback branches when hashed lookup
  ran in tests instead), `api/routes/profiles.py` 68% (cancellation
  edge cases), `worker/arq_worker.py` 0% (prod entry point — still
  Phase 5 work).
- **Smoke compatibility.** No env-var changes to the smoke
  procedure: same `BOOTSTRAP_API_KEYS=acme:smoke-key` works because
  the bootstrap fallback is still wired. Production should provision
  rows in `api_keys` instead.
