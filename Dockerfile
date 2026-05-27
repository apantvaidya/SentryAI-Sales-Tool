# syntax=docker/dockerfile:1.7
#
# Multi-stage build for SentryScraperModule. Phase 5.
#
# Stage 1 (`builder`) installs the project + its runtime dependencies
# into a throwaway venv. Stage 2 (`runtime`) copies that venv into a
# clean slim image and runs as a non-root user.
#
# Build:
#   docker build -t sentry-scraper:local .
# Run API:
#   docker run --rm -p 8000:8000 \
#     -e DATABASE_URL=... -e REDIS_URL=... -e BOOTSTRAP_API_KEYS=... \
#     sentry-scraper:local
# Run worker (override CMD):
#   docker run --rm sentry-scraper:local \
#     arq sentry_scraper_module.worker.arq_worker.WorkerSettings

# ---------------------------------------------------------------------------
# Builder
# ---------------------------------------------------------------------------
FROM python:3.13-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

# `gcc` is required for the few wheels we don't get prebuilt
# (e.g. `uvloop` on some platforms). Drop it from the runtime stage.
RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy only what's needed to resolve and install the project. We deliberately
# avoid `--prefix` so the venv layout matches what `runtime` expects.
COPY pyproject.toml README.md ./
COPY src ./src

RUN python -m venv /opt/venv \
    && /opt/venv/bin/pip install --upgrade pip \
    && /opt/venv/bin/pip install .

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM python:3.13-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH" \
    APP_ENV=prod \
    LOG_FORMAT=json

# Non-root user. Fly + Kubernetes both prefer this for security; the
# uid is fixed so volume permissions are deterministic across deploys.
RUN groupadd --system --gid 1001 sentry \
    && useradd --system --uid 1001 --gid sentry --create-home sentry

WORKDIR /app

COPY --from=builder /opt/venv /opt/venv
COPY alembic.ini ./
COPY migrations ./migrations
COPY src ./src

# `auto_create_tables=False` in prod — schema lives behind Alembic. The
# RUNBOOK documents `alembic upgrade head` as the deploy-time step.
ENV AUTO_CREATE_TABLES=false

USER sentry

EXPOSE 8000

# Default to the API. Compose / Fly override CMD for the worker
# process group.
CMD ["uvicorn", "sentry_scraper_module.api.main:app", \
     "--host", "0.0.0.0", "--port", "8000"]
