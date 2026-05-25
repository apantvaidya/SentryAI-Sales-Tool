# SentryScraperModule

> **Status:** Phase 0 — repo skeleton.
>
> Deep-Context AI Profiling Scraper API. Builds high-fidelity, contextualised
> profiles of target individuals to power hyper-personalised cold outreach.

The full requirements, architecture, and phased implementation plan live in
`docs/`:

- [`docs/PRD.md`](docs/PRD.md) — product requirements (source of truth).
- [`docs/DESIGN.md`](docs/DESIGN.md) — architecture, agent graph, anti-bot,
  compliance, decision log.
- [`docs/PLAN.md`](docs/PLAN.md) — phased delivery (Phase 0 → Phase 5).

## Quick start (Phase 0)

Requires Python 3.11+.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"

# lint, type-check, test
ruff check .
ruff format --check .
mypy
pytest

# run the API
uvicorn sentry_scraper_module.api.main:app --reload
curl http://127.0.0.1:8000/healthz
# => {"ok":true,"version":"0.0.1","env":"dev"}
```

## Layout

```
src/sentry_scraper_module/
├── api/         FastAPI app factory + routes
└── core/        config, structured logging, error hierarchy
tests/           pytest suites mirroring src/
docs/            PRD + DESIGN + PLAN
```

Subsequent phases will add `agents/`, `providers/`, `compliance/`, and
`persistence/` packages per `docs/DESIGN.md §2`.

## Configuration

Copy `.env.example` to `.env` and fill in the variables required by the
phase you are working on. Phase 0 only needs `APP_ENV`, `LOG_LEVEL`, and
`LOG_FORMAT`; later phases add LLM, SERP, proxy, browser, and database
credentials.

## License

Proprietary. Not for redistribution.
