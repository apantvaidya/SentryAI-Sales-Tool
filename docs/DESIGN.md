# Design: SentryScraperModule Deep-Context Profiling Engine

Companion to `PRD.md`. This document fixes architecture, module boundaries,
agent contracts, data flow, and the anti-bot / compliance designs.

All provider and infrastructure choices listed in `PLAN.md` are now
**resolved**; see §12 for the consolidated decision log.

---

## 1. High-Level Architecture

```
                       ┌──────────────────────────────────────┐
   client ──► POST ──► │           FastAPI gateway            │
                ◄──202─│  /v1/profiles  ── enqueue job        │
   client ──► GET ───► │  /v1/profiles/{job_id} ── poll       │
                       │  /v1/erasure   /healthz              │
                       └──────────────┬───────────────────────┘
                                      │  job enqueued (arq / Redis)
                                      ▼
                       ┌──────────────────────────────────────┐
                       │              Worker                  │
                       └──────────────┬───────────────────────┘
                                      │  ProfileState
                                      ▼
                       ┌──────────────────────────────────────┐
                       │     LangGraph orchestrator           │
                       │                                      │
                       │  plan → fetch_static → escalate? ──► │
                       │   │       │             │            │
                       │   │       │             ▼            │
                       │   │       │       fetch_headless     │
                       │   │       ▼             │            │
                       │   │   distill ◄─────────┘            │
                       │   │       │                          │
                       │   │   chunk_and_rank                 │
                       │   │       │                          │
                       │   ▼       ▼                          │
                       │  extract → validate → compliance     │
                       └──────────────┬───────────────────────┘
                                      │  Profile + metadata
                                      ▼
            ┌──────────────────┐  ┌───────────────────┐  ┌──────────────────┐
            │     Postgres     │  │  Object storage   │  │   Audit log      │
            │ jobs, profiles,  │  │  raw page snaps   │  │  PII redactions  │
            │ tenants, supp.   │  │                   │  │                  │
            └──────────────────┘  └───────────────────┘  └──────────────────┘
```

External dependencies are isolated behind the `providers/` package so each can
be swapped or mocked without touching agent logic.

---

## 2. Module Layout

```
SentryScraperModule/
├── pyproject.toml
├── README.md
├── .env.example
├── docs/
│   ├── PRD.md
│   ├── DESIGN.md
│   └── PLAN.md
└── src/sentry_scraper_module/
    ├── api/
    │   ├── main.py          # FastAPI app factory
    │   ├── routes.py        # /v1/profiles, /v1/erasure, /healthz
    │   ├── schemas.py       # Pydantic I/O models
    │   └── auth.py          # static API-key middleware (multi-tenant)
    ├── agents/
    │   ├── graph.py         # LangGraph state machine
    │   ├── state.py         # ProfileState TypedDict
    │   ├── planner.py       # SERP query construction + URL ranking
    │   ├── scraper.py       # Static-first fetcher w/ escalation hook
    │   ├── distiller.py     # HTML → Markdown
    │   ├── chunker.py       # Embedding-based chunk selection
    │   ├── extractor.py     # LLM extraction → schema
    │   └── confidence.py    # Confidence aggregation
    ├── providers/
    │   ├── llm.py           # LiteLLM client (multi-provider)
    │   ├── embeddings.py    # Local sentence-transformers
    │   ├── serp.py          # Serper.dev adapter
    │   ├── proxy.py         # Smartproxy residential router
    │   └── browser.py       # Browserless WS client (Playwright local in dev)
    ├── compliance/
    │   ├── suppression.py   # Opt-out list lookups
    │   ├── pii_filter.py    # Drop prohibited PII categories
    │   └── audit.py         # Append-only audit log
    ├── core/
    │   ├── config.py        # pydantic-settings
    │   ├── logging.py       # structlog
    │   ├── errors.py        # Typed error hierarchy
    │   ├── fingerprint.py   # Coherent header set generator
    │   └── cache.py         # Redis/disk cache adapter
    └── persistence/
        ├── models.py        # SQLModel tables (Postgres)
        └── repository.py    # CRUD helpers
```

Tests mirror the source tree under `tests/unit/` and `tests/integration/`.

---

## 3. Agent Graph (LangGraph)

### 3.1 Shared State

```python
class URLCandidate(BaseModel):
    url: HttpUrl
    source: Literal["seed", "serp"]
    rank_score: float
    rationale: str

class FetchedPage(BaseModel):
    url: HttpUrl
    status: int
    body: str           # raw HTML or rendered DOM
    fetched_via: Literal["static", "headless"]
    fingerprint_id: str
    bytes_in: int

class DistilledPage(BaseModel):
    url: HttpUrl
    markdown: str
    title: str | None
    word_count: int

class Chunk(BaseModel):
    page_url: HttpUrl
    text: str
    similarity: float

class ProfileState(TypedDict):
    request: ProfileRequest
    candidate_urls: list[URLCandidate]
    fetched: list[FetchedPage]
    distilled: list[DistilledPage]
    chunks: list[Chunk]
    profile: Profile | None
    errors: list[StageError]
    metadata: BuildMetadata
```

### 3.2 Nodes

| Node              | Responsibility                                                                                  | Failure mode                              |
| ----------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `plan`            | Build SERP query from name/company; merge `seed_urls`; cap to N URLs (default 5); rank.         | Empty result ⇒ `InsufficientSourcesError` |
| `fetch_static`    | Parallel `httpx` GETs through residential proxy; record bytes/status.                            | Per-URL failure recorded, others proceed  |
| `decide_escalate` | Conditional edge: any page needs JS or returned challenge → route to `fetch_headless`.          | n/a                                       |
| `fetch_headless`  | Playwright + stealth for flagged URLs only; capture rendered DOM + screenshot.                  | Browser timeout ⇒ skip page, log          |
| `distill`         | Strip boilerplate, convert each page to clean Markdown. Drop pages under N words after strip.   | All empty ⇒ `NoExtractableContent`        |
| `chunk_and_rank`  | If a page exceeds token budget, chunk + embed + cosine-rank against `target_name + role` query. | Falls through with empty selection        |
| `extract`         | Single LLM call with concatenated top-k chunks + schema; produce structured profile.            | Schema validation retry × 1               |
| `validate`        | Pydantic strict validation; compute per-field confidence from source agreement.                 | Invalid ⇒ partial profile + low score     |
| `compliance`      | Suppression-list intersection; strip prohibited PII categories; audit-log redactions.           | Suppressed target ⇒ 451 response          |

### 3.3 Escalation Heuristics

A page is flagged for headless rendering when any of the following hold:

- HTTP status in `{403, 429, 503}` and body length < 5 KB.
- Body contains a known WAF signature
  (`cf-mitigated`, `__cf_chl_jschl_tk__`, `_Incapsula_Resource`, `pxhd`, `datadome`).
- `<noscript>You need to enable JavaScript</noscript>` matches the body.
- Body has fewer than 200 words after a quick boilerplate strip.

### 3.4 Job Lifecycle (async with polling)

The API is async-with-polling. The client never holds a long connection.

```
POST /v1/profiles
  body:  ProfileRequest
  ↳ 202 Accepted
     body: { job_id, status: "queued", poll_url, eta_ms }

GET  /v1/profiles/{job_id}
  ↳ 200 OK while running:
     { job_id, status: "queued" | "running", progress_stage, eta_ms }
  ↳ 200 OK on success:
     { job_id, status: "done", profile, metadata }
  ↳ 200 OK on failure:
     { job_id, status: "failed", error }
  ↳ 451 if target is on the suppression list at any point.
  ↳ 410 Gone if the job is past its retention window.

DELETE /v1/profiles/{job_id}
  ↳ 204 — caller-driven cancel; safe even after completion (purges result).
```

Job storage uses the `jobs` table (`persistence/models.py`):

| Column         | Type        | Notes                                                  |
| -------------- | ----------- | ------------------------------------------------------ |
| `id`           | UUID PK     | returned as `job_id`                                   |
| `tenant_id`    | UUID        | foreign key, indexed                                   |
| `request`      | JSONB       | original `ProfileRequest`                              |
| `status`       | enum        | `queued, running, done, failed, cancelled`             |
| `stage`        | text        | current LangGraph node name when `running`             |
| `result`       | JSONB null  | populated on `done`                                    |
| `error`        | JSONB null  | populated on `failed`                                  |
| `created_at`   | timestamptz |                                                        |
| `started_at`   | timestamptz |                                                        |
| `completed_at` | timestamptz |                                                        |
| `expires_at`   | timestamptz | default `now() + interval '7 days'`                    |

Workers are in-process for dev (FastAPI `BackgroundTasks`) and a separate
worker process in prod (an `arq` queue backed by Redis is the default; ADR-1
documents the choice). Stage transitions are written back to the row so
`progress_stage` is meaningful to pollers.

Recommended polling cadence: 1 s for the first 5 s, then exponential backoff
to 5 s. The response includes `eta_ms` to help the client schedule polls.

### 3.5 Cost / Latency Budget per Request

| Stage           | Calls                 | Bytes shipped to LLM | Wall time target |
| --------------- | --------------------- | -------------------- | ---------------- |
| SERP            | 1                     | 0                    | < 1 s            |
| Static fetch    | ≤ 5                   | 0                    | < 3 s            |
| Headless fetch  | ≤ 2 (only escalated)  | 0                    | < 10 s           |
| Distill         | 0 (local)             | 0                    | < 1 s            |
| Embed + rank    | 0 (local model)       | 0                    | < 1 s            |
| Extract (LLM)   | 1 (rarely 2 on retry) | ≤ 8k tokens          | < 8 s            |
| **Total**       |                       |                      | **< 15 s p50**   |

---

## 4. Token & HTTP Optimization

Concrete rules baked into the pipeline:

1. **One SERP call per request.** Re-rank locally; never re-query SERP just to
   look at page 2.
2. **Static-first fetch.** Headless is opt-in per URL via the escalation
   heuristic, not blanket.
3. **Pre-LLM strip.** `trafilatura` + Crawl4AI heuristic pass typically removes
   85–95% of bytes from a complex page.
4. **Markdown, not HTML.** Markdown averages ~3× fewer tokens than the source
   HTML for the same semantic content.
5. **Embed-and-rank.** Pages above a token threshold (default 3k tokens) are
   chunked at ~500 tokens with 50-token overlap, embedded with
   `all-MiniLM-L6-v2`, and only the top-k chunks (default 3) survive.
6. **Single consolidated extraction.** All surviving chunks are merged into one
   LLM call with a strict JSON schema; we do *not* call the LLM per page.
7. **Cache at two layers.** SERP results by `(name, company)` for 24 h; final
   profiles by `(name, company, context_goal_hash)` for 7 d.

---

## 5. Provider Abstractions

Each provider lives behind a Protocol so concrete adapters can be mock or real.

```python
class SerpProvider(Protocol):
    async def search(self, query: str, *, num: int = 10) -> list[SerpResult]: ...

class ProxyProvider(Protocol):
    def session(self) -> ProxySession: ...   # session-sticky residential IP

class BrowserProvider(Protocol):
    async def render(self, url: str, *, session: ProxySession) -> RenderedPage: ...

class LLMProvider(Protocol):
    async def complete_json(
        self, *, system: str, user: str, schema: type[BaseModel]
    ) -> BaseModel: ...

class EmbeddingProvider(Protocol):
    def embed(self, texts: list[str]) -> np.ndarray: ...   # local; sync OK
```

Resolved provider choices (see §12 for the full decision log):

- **SERP** — Serper.dev (cheap, fast, JSON).
- **LLM** — LiteLLM client. Primary model `openai/gpt-4o-mini`; fallback chain
  `anthropic/claude-3-5-haiku` then `openai/gpt-4o`. Structured output via
  LiteLLM's `response_format` JSON-schema mode.
- **Embeddings** — `sentence-transformers/all-MiniLM-L6-v2` (local, 80 MB).
- **Proxy** — Smartproxy Residential (session-sticky endpoint).
- **Browser** — Managed Browserless.io (Playwright over WebSocket). Local
  Playwright is used only for tests.

---

## 6. Anti-Bot Strategy

### 6.1 Proxy Routing

- All outbound HTTP — both static fetcher and Browserless renderer — routes
  through `providers/proxy.py` (Smartproxy residential).
- One session-sticky IP per profile build, so multi-page fetches from the same
  target site look like one human. Smartproxy session IDs are minted as
  `tenant_id + job_id` so the same job consistently reuses one IP and parallel
  jobs from the same tenant do not collide.
- A new session is minted per profile build; sessions are never reused across
  unrelated requests.
- The Browserless WebSocket endpoint is configured with Smartproxy upstream so
  rendered traffic shares the same residential IP as the static probes.

### 6.2 Header Fingerprinting

`core/fingerprint.py` produces a coherent header set per session:

- `User-Agent` sampled from a curated pool of current Chrome/Firefox/Safari
  versions; weighted toward Chrome on Windows/macOS desktop.
- `sec-ch-ua`, `sec-ch-ua-platform`, `sec-ch-ua-mobile` matched to the UA.
- `Accept-Language` sampled to align with the proxy's geo when available.
- `Referer` set to a plausible source (Google, LinkedIn, the target's own
  domain) per URL.
- Connection ordering matches a real browser (Accept first, etc.).

### 6.3 Headless Stealth

- Browserless-hosted Playwright with stealth flags enabled
  (`blockAds=true`, `stealth=true`, `humanize=true` in the connect URL) and
  client-side `playwright-stealth` patches: `navigator.webdriver`, plugin
  array, WebGL vendor, `chrome.runtime`, permission spoofing.
- Randomized viewport (1280–1920 × 720–1080).
- Human-like behavior: 200–700 ms before first interaction, mouse-move to a
  randomized location, slow scroll over 1.5–3 s, then DOM capture.
- Hard 15 s navigation timeout; abort on heavy 3rd-party resources via route
  filters to cut latency.
- Local Playwright runs only in tests (`BROWSER_PROVIDER=local`).

### 6.4 Failure Handling

- Per-URL exponential backoff with jitter, max 2 retries.
- After all retries, the URL is dropped from `candidate_urls` and the build
  continues. `metadata.sources_used` reflects only pages that contributed.

---

## 7. Compliance & Privacy

### 7.1 Suppression List

- Table `suppression(target_hash, reason, created_at)`.
- `target_hash = sha256(lower(name) + lower(company))`.
- Checked **twice**: at request acceptance (fast 451 if matched) and at
  pre-response (defense-in-depth after extraction).

### 7.2 PII Categories

`compliance/pii_filter.py` drops or redacts anything matching:

- Health, medical history, disability.
- Family members, relationships, marital status.
- Financial accounts, salary specifics, credit info.
- Religion, sexuality, political affiliation.
- Government IDs of any form.

Implementation: a labeled regex + keyword pass after extraction, plus a system
prompt that explicitly instructs the extractor to stay B2B. Both layers in
defense-in-depth.

### 7.3 Data Lifecycle

- Extracted profiles default to 30-day TTL; configurable per tenant.
- `DELETE /v1/erasure` endpoint accepts `{ target_name, company_name }` or
  `{ email }`, hashes, adds to suppression list, and purges any cached
  profile/audit entries within 24 h.
- Audit log retained 90 days (configurable) for incident response.

### 7.4 What the Extractor Is Allowed To Say

The system prompt for `extract` constrains:

- Output **only** what is supported by the supplied source text. No
  speculation, no invented numbers.
- `cost_metrics` must include the source snippet that justified it; otherwise
  the field stays empty.
- `how_we_benefit_them` is a synthesis but must reference only items already in
  `pain_points` or `responsibilities`.

---

## 8. Confidence Scoring

Per-field confidence is computed as a weighted blend:

- **Source agreement** (0.5): fraction of distinct distilled pages that
  mention the same value.
- **Source authority** (0.3): tiered weights — `linkedin.com` & official
  company domain (1.0), reputable news (0.8), blog/forum (0.4).
- **Extractor self-report** (0.2): the LLM is asked to rate evidence quality
  per field on a 0–1 scale.

Top-level `confidence_score` is the mean across non-empty fields, clipped to
`[0, 1]`. Below `0.4` the API still returns 200 but flags `low_confidence` in
metadata.

---

## 9. Error Model

All exceptions surface via the API as:

```json
{
  "error": {
    "code": "INSUFFICIENT_SOURCES",
    "message": "No usable pages survived fetch + distillation.",
    "stage": "distill",
    "retryable": true,
    "details": { "candidate_count": 5, "fetched_count": 2, "distilled_count": 0 }
  }
}
```

Codes: `INVALID_REQUEST`, `SUPPRESSED`, `INSUFFICIENT_SOURCES`,
`UPSTREAM_BLOCKED`, `UPSTREAM_TIMEOUT`, `EXTRACTION_FAILED`,
`INTERNAL`.

---

## 10. Observability

- `structlog` with one log line per node, including request id, stage, ms,
  bytes_in, bytes_out, and outcome.
- OpenTelemetry spans wrap each node; exporter pluggable.
- Prometheus metrics: per-node latency histogram, escalation rate, proxy error
  rate, LLM token counters, suppression hit counter.

---

## 11. Non-Goals (for now)

- LinkedIn account-based scraping (TOS minefield; we treat LinkedIn pages as
  read-only public-result targets via SERP only).
- Real-time webhook integrations into CRMs.
- Multi-target batch endpoints (will follow once single-target is stable).
- A UI. API-only in this phase.

---

## 12. Decision Log

| # | Topic           | Decision                                                                                  |
| - | --------------- | ----------------------------------------------------------------------------------------- |
| 1 | Hosting         | **Fly.io** primary; Cloud Run as secondary (same Dockerfile; cost-compared at deploy).    |
| 2 | SERP            | **Serper.dev**.                                                                           |
| 3 | LLM             | **LiteLLM** client; primary `openai/gpt-4o-mini`, fallback `anthropic/claude-3-5-haiku`.  |
| 4 | Residential proxy | **Smartproxy** residential, session-sticky.                                             |
| 5 | Headless host   | **Managed Browserless.io** in prod; local Playwright in tests.                            |
| 6 | API mode        | **Async with polling** — see §3.4.                                                       |
| 7 | Auth            | **Static API keys** (per-tenant). `Authorization: Bearer <key>` header. Hashed at rest.   |
| 8 | Persistence     | **Postgres from day one** (SQLModel + Alembic). Tests use an ephemeral Postgres or SQLite-in-memory adapter where Postgres-specific types are not exercised. |
| 9 | Tenancy         | **Multi-tenant**. Every row carries `tenant_id`. API keys map to a tenant. Per-tenant rate limits and suppression lists. |
| 10| Naming          | **SentryScraperModule** (product), `sentry_scraper_module` (Python package).              |

The ADRs that record the *why* live in `docs/adr/` (created lazily as each
choice is exercised in code).
