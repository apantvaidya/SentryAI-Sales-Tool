# Implementation Plan

## Build Order

This plan is sequenced to deliver usable value early while keeping external dependencies isolated.

## Step 1: Bootstrap the Project

Create the base project structure and tooling:

- `pyproject.toml`
- `exa_searching/`
- `exa_payload_templates/`
- `.env.example`
- `README.md`
- `data/`
- `data/leads.json`

Add:

- Pydantic
- httpx
- tenacity
- ruff

Inside `exa_searching/`, prefer a flat set of modules instead of many nested folders.

Suggested first-pass files:

- `config.py`
- `models.py`
- `queries.py`
- `exa.py`
- `mapper.py`
- `filters.py`
- `dedupe.py`
- `store.py`
- `runner.py`
- `cli.py`

## Step 2: Define Models

Implement Pydantic models in `exa_searching/models.py` for:

- `SeedPersona`
- `PersonaLeadRecord`
- `PersonaLeadBatch`
- internal models for raw candidate, mapped candidate, and qualified candidate

For the current phase, keep `public_business_email` in the output schema but always set it to `None`.

## Step 3: Build the Query Generator

Create query-loading and rendering logic in `exa_searching/queries.py` that:

- renders the seven PRD vectors
- appends the shared suffix
- skips LinkedIn-based vectors when `linkedin_url` is missing
- labels each query with its vector type for downstream traceability
- loads template text from `exa_payload_templates/` rather than hardcoding query strings inline

## Step 4: Add the Exa Module

Implement Exa request logic in `exa_searching/exa.py` that:

- accepts a query payload
- loads query text from the `.txt` files in `exa_payload_templates/`
- calls Exa `category=people`
- returns normalized result nodes
- handles empty responses, HTTP errors, and timeouts
- writes run artifacts into `data/`

## Step 5: Implement Deterministic Entity Mapping

Create deterministic mapping logic in `exa_searching/mapper.py` that:

- drops results with no `entities`
- uses `entities[0].properties`
- selects the best current job using the PRD rules
- resolves location from current role first, then profile location
- calculates `years_at_current_role` when possible
- writes mapped outputs into `data/` for inspection

## Step 6: Implement Qualification Rules

Create qualification logic in `exa_searching/filters.py` that:

- enforces required field presence
- applies title blacklist rules
- applies the founder/CEO/owner exception based on the seed persona
- marks ambiguous records as `needs_review`

## Step 7: Implement Deduplication

Create deduplication logic in `exa_searching/dedupe.py` that:

- canonicalizes LinkedIn URLs
- builds secondary keys from normalized name and company
- keeps the more complete record when duplicates collide

## Step 8: Implement Local Storage

Create JSON persistence logic in `exa_searching/store.py` that:

- reads the local JSON store
- appends new leads
- updates an existing lead only if the new one is more complete
- writes only final cleaned lead fields
- writes `public_business_email` as `null` for now

## Step 9: Orchestrate the Pipeline

Create a top-level runner in `exa_searching/runner.py` that runs:

1. input validation
2. query generation
3. Exa retrieval
4. mapping
5. filtering
6. deduplication
7. artifact writing to `data/`
8. persistence to `data/leads.json`
9. final batch response assembly with empty email fields

At this point we should have a complete backend workflow.

## Step 10: Expose the MVP

Add:

- CLI command such as `python -m exa_searching.cli run-seed --input seed.json`

Keep the MVP local-first for now rather than adding an API surface.

## Step 11: Add Manual Verification Fixtures

Create local sample payloads for:

- clean Exa person result
- no-entity result
- malformed work-history result
- concurrent-role result
- recruiter noise result
- duplicate cross-vector result

Use these to manually validate mapper, filter, and dedup behavior while the MVP is still being shaped, and keep them near the Exa-first workflow.

## Step 12: Operational Readiness

Add:

- structured logs for each pipeline stage
- stage-level counts for searched, mapped, dropped, reviewed, deduplicated, and persisted records
- a concise run summary in CLI output
- setup and usage instructions

## Initial Task Breakdown

### Sprint 1

- bootstrap repo
- define models
- implement query builder
- implement mapper
- implement filter layer

### Sprint 2

- implement Exa client
- implement dedup and storage
- wire full orchestration
- add `data/` artifact writing
- add manual verification payloads

### Sprint 3

- finalize CLI surface
- add hardening and operational polish

## Recommended First Coding Slice

The best first coding slice is:

1. project scaffold
2. models
3. query builder
4. entity mapper
5. filter and dedup core

That slice gives us a working pipeline skeleton before we spend time on later enrichment work.

## Definition of Done for MVP

The MVP is done when a user can submit a seed persona and the system can:

- retrieve candidates from Exa
- deterministically map and filter them
- deduplicate them
- write Exa artifacts and mapped outputs into `data/`
- store final cleaned records locally
- leave `public_business_email` empty for now
- return separated same-company and similar-company results

## Assumptions

- we do not need separate folders for every concern until the codebase actually grows into them
- review-tagged records can remain in memory for MVP and do not require a separate review queue yet
- persistence remains file-based for MVP, with a future path to database storage if volume grows
- email and content enrichment are explicitly deferred to a later phase
- formal automated tests are intentionally deferred until after the first working pipeline cut
