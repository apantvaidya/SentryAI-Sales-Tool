# SentryScraperModule Runbook

Operational reference for running the service in dev, staging, and prod.
Pairs with `docs/DESIGN.md` (architecture) and `docs/PLAN.md` (phase
plan). Phase 5 deliverable.

---

## 1. Environments

| Environment | DB | Queue | Container runtime |
|---|---|---|---|
| **Local dev (no infra)** | SQLite `./sentry.db` | In-process FastAPI BackgroundTasks | `uvicorn` directly on host |
| **Local prod-like** | Postgres in Docker | Redis in Docker, `arq` worker | `docker compose up` |
| **Production** | Fly Managed Postgres | Fly Upstash Redis, `arq` worker process group | Fly machines |

The same image (`Dockerfile`) is used for compose and Fly. Differences are env-only.

---

## 2. First-time provisioning

### 2.1 Local dev (no Docker)

```bash
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
cp .env.example .env  # add BOOTSTRAP_API_KEYS at minimum
.venv/bin/uvicorn sentry_scraper_module.api.main:app --reload
```

In this mode `DATABASE_URL` is unset → SQLite, `REDIS_URL` is unset →
in-memory cache + rate limiter, no `arq` worker required.

### 2.2 Local prod-like (compose)

```bash
cp .env.example .env  # fill in any provider keys you want exercised
docker compose up --build
```

`compose` starts Postgres, Redis, runs `alembic upgrade head` via the
`migrate` service, then starts `api` and `worker`. Tear down + reset:

```bash
docker compose down -v
```

### 2.3 Production (Fly)

```bash
# One-time
fly launch --no-deploy --copy-config
fly postgres create --name sentry-db
fly postgres attach sentry-db                  # sets DATABASE_URL secret
fly redis create --name sentry-redis           # then copy URL into REDIS_URL
fly secrets set REDIS_URL=redis://...
fly secrets set BOOTSTRAP_API_KEYS=acme:<rotate-immediately>
fly secrets set OPENAI_API_KEY=...
fly secrets set ANTHROPIC_API_KEY=...
fly secrets set SERPER_API_KEY=...
fly secrets set SMARTPROXY_USERNAME=... SMARTPROXY_PASSWORD=...
fly secrets set BROWSERLESS_TOKEN=...

# Each deploy
fly deploy
```

The `[deploy] release_command = "alembic upgrade head"` line in
`fly.toml` runs migrations on a one-off machine before traffic is
swapped. A failed migration aborts the deploy.

---

## 3. Required + optional secrets

| Variable | Required? | Purpose |
|---|---|---|
| `DATABASE_URL` | prod yes / dev optional | Async DSN, e.g. `postgresql+asyncpg://...`. Defaults to SQLite when unset. |
| `REDIS_URL` | prod yes / dev optional | Required for `arq` worker. Cache + rate-limit fall back to in-memory when unset. |
| `BOOTSTRAP_API_KEYS` | yes (any authed call) | `slug:plaintext` pairs, comma-separated. |
| `OPENAI_API_KEY` | optional | Falls back to `FakeLLM`. |
| `ANTHROPIC_API_KEY` | optional | LiteLLM fallback when OpenAI errors. |
| `SERPER_API_KEY` | optional | Falls back to `FakeSerp`. |
| `SMARTPROXY_USERNAME` + `SMARTPROXY_PASSWORD` | both or neither | Partial credentials silently fall back to `MockProxy`. |
| `BROWSERLESS_TOKEN` | optional | Falls back to `StubBrowser` (no real headless render). |
| `RATE_LIMIT_PER_MINUTE` | optional, default `0` | Per-tenant token-bucket refill rate. `0` disables. |
| `RATE_LIMIT_BURST` | optional, default `0` | Bucket capacity. `0` → `2 * RATE_LIMIT_PER_MINUTE`. |
| `METRICS_ENABLED` | optional, default `true` | Mounts `/metrics`. |
| `AUTO_CREATE_TABLES` | optional, default `true` | **Set to `false` in production**. Migrations live in Alembic. |

See `@/Users/aran/code/SentryAI-Sales-Tool/src/sentry_scraper_module/core/config.py` for the canonical definitions.

---

## 4. Migrations

Schema is owned by Alembic. The runtime `create_all` path is dev-only
(`AUTO_CREATE_TABLES=true`) and is explicitly disabled in `Dockerfile`
+ `fly.toml`.

### 4.1 Generate a new revision

```bash
DATABASE_URL=sqlite+aiosqlite:///./local.db \
  .venv/bin/alembic revision --autogenerate -m "describe_change"
```

Always review the generated file in `migrations/versions/` before
committing. Alembic doesn't catch every kind of drift (column reorders,
constraint name changes); hand-edit when needed.

### 4.2 Apply migrations

```bash
# Local
DATABASE_URL=postgresql+asyncpg://sentry:sentry@localhost:5432/sentry \
  .venv/bin/alembic upgrade head

# Compose (one-shot service)
docker compose run --rm migrate

# Production
fly deploy   # runs `alembic upgrade head` automatically
```

### 4.3 Rollback

```bash
fly ssh console
alembic downgrade -1
```

Then redeploy with the rolled-back migration removed from
`migrations/versions/`. Never delete a revision that's been applied to a
prod DB without first downgrading past it.

---

## 5. Day-2 operations

### 5.1 Logs

```bash
fly logs                        # streaming
fly logs --since 1h | jq        # JSON-formatted (LOG_FORMAT=json)
```

Look for:
- `worker_job_started` / `worker_job_done` / `worker_job_failed`
- `profiling_error` (typed domain error returned to client)
- `unhandled_error` (5xx — should be alerted on)

### 5.2 Metrics

The `/metrics` endpoint exposes the Prometheus text format on the
`api` group only. Key series:

| Metric | Type | Use |
|---|---|---|
| `sentry_jobs_submitted_total{tenant_slug}` | Counter | Throughput by tenant |
| `sentry_jobs_completed_total{status}` | Counter | done vs failed vs cancelled split |
| `sentry_job_duration_seconds{status}` | Histogram | p50 / p95 latency |
| `sentry_pipeline_stage_duration_seconds{stage}` | Histogram | Per-LangGraph-node latency |
| `sentry_rate_limit_rejects_total{tenant_slug}` | Counter | 429 rate (alert > 5/min sustained) |
| `sentry_suppression_rejects_total{stage}` | Counter | Compliance signal |
| `sentry_pii_redactions_total{category}` | Counter | Compliance signal |

### 5.3 Common tasks

**Provision a new tenant + API key.**
```python
# SSH into a Fly machine first, then:
import asyncio, uuid
from sentry_scraper_module.core.config import get_settings
from sentry_scraper_module.persistence.database import (
    make_engine, make_session_factory,
)
from sentry_scraper_module.persistence.repository import (
    upsert_tenant, create_api_key,
)

async def main():
    s = get_settings()
    engine = make_engine(s.database_url)
    Session = make_session_factory(engine)
    async with Session() as session:
        tenant = await upsert_tenant(session, slug="customer-x")
        plaintext, row = await create_api_key(
            session, tenant_id=tenant.id, label="customer-x prod key",
        )
        print(plaintext)  # share this once; only the hash is stored
asyncio.run(main())
```

**Revoke a key.** Look up the row id (`SELECT id, label FROM api_keys
WHERE tenant_id = ...`) then call `revoke_api_key(session, key_id, now=...)`.
The next request with that key returns 401 immediately.

**Add a target to the suppression list.**
```python
from sentry_scraper_module.compliance.suppression import suppression_target_hash
from sentry_scraper_module.persistence.repository import add_suppression
target_hash = suppression_target_hash(target_name="...", company_name="...")
await add_suppression(session, target_hash=target_hash, reason="GDPR-erasure")
```
Subsequent `POST /v1/profiles` for that target returns 451.

### 5.4 Scaling

```bash
fly scale count api=3 worker=2          # horizontal
fly scale vm performance-2x --process-group worker  # vertical
```

The Redis-backed rate limiter is the only piece sensitive to API
replica count; the in-memory limiter is replica-local and over-admits
under multi-machine load. Production must keep `REDIS_URL` set.

---

## 6. Incident playbook

### 6.1 5xx spike

1. `fly logs --since 10m | grep unhandled_error | jq -r .error_type` — group by exception type.
2. Hit `/metrics` and check `sentry_jobs_completed_total{status="failed"}` rate.
3. If a single upstream is the culprit (Serper, OpenAI, Smartproxy), unset its key in `fly secrets unset` to force a graceful fallback, then redeploy.
4. If migrations are the cause: `fly releases` to find the failing release, `fly deploy --image <previous-image-id>` to roll back.

### 6.2 Worker queue backlog

```bash
fly redis connect
> XLEN arq:queue
```

If the queue is growing unboundedly: `fly scale count worker=N` until
LLEN trends down. The runner is idempotent on terminal states, so
killing a worker mid-job is safe — the job will be picked up again.

### 6.3 Rate-limit false positives

If legitimate traffic is being 429'd:
1. Check `sentry_rate_limit_rejects_total{tenant_slug}` to confirm the affected tenant.
2. Bump `RATE_LIMIT_PER_MINUTE` (and proportionally `RATE_LIMIT_BURST`) via `fly secrets set` and `fly deploy` — limits are read at startup.
3. Long-term: move per-tenant overrides into the `tenants` table (Phase 6+).

---

## 7. Cleanup

```bash
fly redis destroy sentry-redis
fly postgres destroy sentry-db
fly apps destroy sentry-scraper-module
```

Local:

```bash
docker compose down -v        # drops volumes
rm -f sentry.db local.db      # SQLite dev files
```
