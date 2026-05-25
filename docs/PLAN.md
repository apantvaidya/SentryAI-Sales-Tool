# Implementation Plan

Sequenced delivery of the design in `DESIGN.md`. Each phase ends with a
demoable artifact and a green test suite for the scope it added. Phase day
counts assume one focused engineer.

---

## Phase 0 — Repo skeleton ⏱ ½ day

**Deliverable:** project boots, `GET /healthz` returns 200, lint + tests run in CI.

- `pyproject.toml` (PEP 621), `ruff`, `mypy --strict`, `pytest`, `pytest-asyncio`.
- `src/sentry_scraper_module/core/{config,logging,errors}.py`.
- `src/sentry_scraper_module/api/main.py` with `/healthz`.
- `.env.example`, `README.md` quick-start.
- GitHub Actions: lint + type-check + unit tests.

**Exit criteria**

- `uvicorn sentry_scraper_module.api.main:app` boots;
  `curl /healthz` returns `{"ok": true, "version": "..."}`.
- `ruff check`, `ruff format --check`, `mypy`, and `pytest` all green locally
  and in CI.

---

## Phase 1 — Core pipeline (no orchestrator) ⏱ 1.5 days

**Deliverable:** a `python -m sentry_scraper_module.scripts.run_pipeline` CLI
that, given a canned HTML fixture set, produces a valid `Profile` JSON.

- `agents/distiller.py` — wraps `trafilatura` + Crawl4AI's heuristic strip,
  emits Markdown + title + word count. Unit tests over fixture pages
  (LinkedIn-like, corporate "about", news article, blog post).
- `agents/chunker.py` — splitter (LangChain `RecursiveCharacterTextSplitter`)
  + local embeddings + cosine ranking. Tests assert top-k selection on a
  contrived doc.
- `providers/embeddings.py` — `sentence-transformers/all-MiniLM-L6-v2`,
  lazy-loaded singleton.
- `providers/llm.py` — Protocol + LiteLLM adapter + `FakeLLM` for tests.
  Primary model `openai/gpt-4o-mini`; fallback chain to
  `anthropic/claude-3-5-haiku`. Structured output via LiteLLM's
  `response_format={"type": "json_schema", ...}`.
- `agents/extractor.py` — single LLM call returning a Pydantic `Profile`.
- `api/schemas.py` — `ProfileRequest`, `Profile`, `BuildMetadata` matching the
  PRD schema exactly.
- `agents/confidence.py` — per-field scoring described in `DESIGN.md §8`.

**Exit criteria**

- Fixture-driven end-to-end (skipping fetch + orchestrator) emits a profile
  that passes Pydantic strict validation.
- Coverage ≥ 80% on `agents/` and `providers/`.

---

## Phase 2 — Orchestration + async API ⏱ 1.5 days

**Deliverable:** `POST /v1/profiles` enqueues a job and returns 202;
`GET /v1/profiles/{job_id}` polls until the LangGraph run completes.

- `agents/state.py`, `agents/graph.py` — LangGraph wiring of nodes from
  `DESIGN.md §3.2`, including the conditional escalation edge.
- `agents/planner.py` — query construction, URL de-dup with `seed_urls`,
  rank by `(authority_tier, serp_position, query_overlap)`.
- `agents/scraper.py` — `httpx.AsyncClient` static fetcher; emits a
  `needs_escalation` flag per page based on heuristics.
- `providers/serp.py` — `FakeSerp` + `SerperProvider` (real, gated by env var).
- `persistence/models.py` — `jobs` table per `DESIGN.md §3.4` (introduced
  here, not Phase 4, because polling depends on it).
- `persistence/repository.py` — `enqueue`, `mark_running`, `update_stage`,
  `mark_done`, `mark_failed`, `get`, `cancel`.
- Worker — `arq` task that pulls a job_id, runs the LangGraph, and writes
  stage transitions back to the row. Dev mode uses FastAPI `BackgroundTasks`
  so no Redis is required to run locally.
- `api/routes.py` — `POST /v1/profiles` (202 + `job_id`), `GET
  /v1/profiles/{job_id}`, `DELETE /v1/profiles/{job_id}`.
- Integration test: enqueue → poll-loop → assert final schema, sources_used,
  confidence, and at least one observed `running` stage value.

**Exit criteria**

- `curl POST /v1/profiles` returns 202 with a `job_id` in < 100 ms.
- Polling `GET /v1/profiles/{job_id}` in fixture mode reaches `done` in < 2 s
  locally with a valid profile body.
- Escalation path is exercised by at least one fixture (HTML body contains
  `cf-mitigated`).
- `DELETE /v1/profiles/{job_id}` cancels an in-flight job and 204s.

---

## Phase 3 — Anti-bot infrastructure ⏱ 1.5 days

**Deliverable:** static fetcher and headless renderer routed through a real
residential proxy and Playwright, gated by env config.

- `providers/proxy.py` — Smartproxy adapter; session-sticky endpoint;
  `ProxyProvider` Protocol with `MockProxy` for tests. Session ID derived
  from `tenant_id + job_id`.
- `core/fingerprint.py` — coherent header set generator; property-based tests
  assert UA / sec-ch-ua / platform consistency.
- `providers/browser.py` — Browserless WS client (prod) with
  `stealth=true&humanize=true&blockAds=true` connect-string flags; local
  `playwright` + `playwright-stealth` only when `BROWSER_PROVIDER=local`
  (tests).
- `agents/scraper.py` — proxy injection; escalation invokes
  `BrowserProvider.render`.
- Integration test (gated, not in CI by default): hit a known
  Cloudflare-protected demo page via Smartproxy + Browserless, assert
  successful render.

**Exit criteria**

- With `SMARTPROXY_USERNAME` + `SMARTPROXY_PASSWORD` and
  `BROWSERLESS_TOKEN` set, an end-to-end run against a real prospect URL
  succeeds.
- Without creds, the system falls back to direct fetch + local Playwright
  and still completes the fixture suite.

---

## Phase 4 — Compliance ⏱ ½ day

**Deliverable:** suppression checks, PII filter, audit log, erasure endpoint.

- `persistence/models.py` — add `Suppression`, `AuditEntry`, `Tenant`, and
  `ApiKey` tables alongside the `jobs` table introduced in Phase 2 (SQLModel;
  Postgres in dev and prod via `DATABASE_URL`).
- `api/auth.py` — `Authorization: Bearer <key>` middleware. Keys are stored
  hashed (`sha256`) and mapped to a tenant. Request state carries `tenant_id`.
- `compliance/suppression.py` — pre- and post-extraction checks.
- `compliance/pii_filter.py` — category-based redactor; emits audit entries
  for every redaction.
- `compliance/audit.py` — append-only log.
- `api/routes.py` — `DELETE /v1/erasure`.

**Exit criteria**

- Suppressed target returns 451 before any external call.
- A test profile containing prohibited categories has them stripped, and the
  audit log records the redactions.

---

## Phase 5 — Hardening + deploy ⏱ 1 day

**Deliverable:** cache, per-tenant rate limiting, observability, Dockerfile,
Fly.io deployment (with Cloud Run instructions as a sidecar option).

- `core/cache.py` — Redis adapter (Upstash-friendly) with in-memory fallback;
  SERP 24 h, profile 7 d.
- Per-tenant token-bucket rate limit (Redis-backed).
- `structlog` JSON output; OpenTelemetry exporter; Prometheus `/metrics`.
- `Dockerfile` (multi-stage, slim base). No Playwright in the API image;
  rendering is delegated to Browserless. Local-dev image variant pulls a
  Playwright base.
- `fly.toml` for the API + worker (process groups `api` and `worker`).
  Secrets (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `SERPER_API_KEY`,
  `SMARTPROXY_USERNAME`, `SMARTPROXY_PASSWORD`, `BROWSERLESS_TOKEN`,
  `DATABASE_URL`, `REDIS_URL`) managed via `fly secrets`.
- `docs/RUNBOOK.md` with deploy, secret rotation, and Cloud Run alternative.

**Exit criteria**

- `docker compose up` runs the API + worker + Postgres + Redis locally and
  serves a fixture-mode build end-to-end.
- `fly deploy` provisions API + worker; `/healthz` reachable; one real
  profile build completes end-to-end against staging credentials.
- p50 latency < 15 s observed on a 20-request synthetic load.

---

## Dependencies (initial picks)

| Concern              | Library / Service                              | Notes                                    |
| -------------------- | ---------------------------------------------- | ---------------------------------------- |
| API                  | `fastapi`, `uvicorn[standard]`                 |                                          |
| Validation/config    | `pydantic` v2, `pydantic-settings`             |                                          |
| HTTP client          | `httpx[http2]`                                 | async                                    |
| Orchestrator         | `langgraph`                                    | conditional edges fit escalation flow    |
| LLM access           | `litellm`                                      | primary `openai/gpt-4o-mini`, fallback `anthropic/claude-3-5-haiku` |
| Distillation         | `trafilatura`, `crawl4ai`, `markdownify`       | layered; trafilatura is the workhorse    |
| Chunking + embed     | `langchain-text-splitters`, `sentence-transformers`, `numpy` |                            |
| SERP                 | `serper.dev` REST (no SDK needed)              |                                          |
| Headless browser     | `playwright`, `playwright-stealth`             | Browserless in prod                      |
| Proxy provider       | Smartproxy Residential                         | per-session sticky endpoint              |
| Persistence          | `sqlmodel`, `alembic`, `asyncpg`               | Postgres dev + prod                      |
| Job queue            | `arq`                                          | Redis-backed; dev uses `BackgroundTasks` |
| Cache                | `redis.asyncio`                                | optional; in-mem fallback                |
| Observability        | `structlog`, `opentelemetry-*`, `prometheus-client` |                                     |
| Test                 | `pytest`, `pytest-asyncio`, `respx`, `freezegun`, `hypothesis` |                          |
| Lint / types         | `ruff`, `mypy`                                 |                                          |

---

## Test Strategy

- **Unit** — pure functions and provider adapters with `respx` mocks. Goal:
  ≥ 85% on `agents/`, `compliance/`, `core/`.
- **Contract** — Pydantic schema round-trips on every fixture profile.
- **Integration** — full LangGraph run with `FakeSerp` + on-disk HTML
  fixtures; one happy path, one escalation path, one suppression hit, one
  insufficient-sources case.
- **External-gated** — real SERP / proxy / browser tests behind
  `pytest -m external`, off by default.
- **Load** — `locust` script in `scripts/load.py`, target 10 req/s sustained.

---

## Resolved Decisions

All open items closed. The canonical decision log lives in `DESIGN.md §12`;
the summary is:

| # | Topic           | Decision                                                                                 |
| - | --------------- | ---------------------------------------------------------------------------------------- |
| 1 | Hosting         | **Fly.io** primary, Cloud Run as cost-compared secondary.                                |
| 2 | SERP            | **Serper.dev**.                                                                          |
| 3 | LLM             | **LiteLLM**; primary `openai/gpt-4o-mini`, fallback `anthropic/claude-3-5-haiku`.        |
| 4 | Residential proxy | **Smartproxy** residential, session-sticky.                                            |
| 5 | Headless host   | **Managed Browserless.io** (local Playwright in tests only).                             |
| 6 | API mode        | **Async with polling.**                                                                  |
| 7 | Auth            | **Static API keys** (per-tenant), hashed at rest.                                        |
| 8 | Persistence     | **Postgres** from day one (SQLModel + Alembic + asyncpg).                                |
| 9 | Tenancy         | **Multi-tenant**; every row carries `tenant_id`; per-tenant rate limits & suppression.   |
| 10| Naming          | **SentryScraperModule** (product), `sentry_scraper_module` (Python package).             |

> The repo directory at `/Users/aran/code/SentryAI` is left as-is for now;
> the user can rename it to `SentryScraperModule` after Phase 0 lands. All
> internal references already use the new name.
