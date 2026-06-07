# Development Plan

## Goal

Build the PRD-defined Lookalike Lead Generation Pipeline as a backend-first MVP that is cheap to run, deterministic in its decision-making, and easy to run locally.

## Recommended MVP Shape

The PRD describes a pipeline module, not a full end-user application. The fastest reliable path is to ship this as:

1. an `exa_searching/` code package for Exa retrieval, structured entity mapping, filtering, deduplication, and output
2. a local CLI for running the pipeline against a seed persona
3. a `data/` folder that receives JSON outputs from Exa runs and mapped records
4. local JSON persistence for accepted lead records in `data/leads.json`
5. email or content enrichment as a later phase

This keeps the first version aligned with the PRD while leaving room for a UI later.

## Product Boundaries

### In Scope

- seed persona intake
- Exa multi-vector people retrieval
- deterministic entity mapping
- hard filtering and review flagging
- deduplication across vectors and stored history
- writing Exa search and mapped artifacts into `data/`
- local JSON storage of final accepted leads
- structured logging and validation

### Out of Scope for MVP

- email enrichment
- content enrichment
- deep page crawling
- LLM-based primary extraction
- outreach generation
- CRM sync
- background job orchestration
- analyst UI

## Recommended Stack

Because this module is an integration-heavy data pipeline, Python is the best fit for the MVP.

- language: Python 3.12+
- schemas and validation: Pydantic v2
- HTTP clients: `httpx`
- retries and backoff: `tenacity`
- config and secrets: environment variables with a typed settings module
- lint and format: `ruff`
- storage: local JSON files under `data/`

Testing should be deferred until we have the first end-to-end pipeline working.

## Proposed Internal Organization

The previous folder split was too abstract for this MVP. We do not need separate `core`, `domain`, `pipeline`, `storage`, and `services` directories yet.

The real system behavior is simpler:

1. define input and output models
2. load and render Exa query templates
3. call Exa
4. map Exa entities into our schema
5. filter and review-tag records
6. deduplicate candidates
7. write Exa search and mapped artifacts into `data/`
8. write final records to local JSON with empty email fields
9. expose the flow through a CLI

That means the cleanest MVP structure is a focused `exa_searching/` package with one module per responsibility.

### Suggested Repository Layout

```text
lead_generation_mod/
  docs/
  exa_payload_templates/
  exa_searching/
    __init__.py
    cli.py
    config.py
    models.py
    queries.py
    exa.py
    mapper.py
    filters.py
    dedupe.py
    store.py
    runner.py
  data/
    leads.json
  scripts/
```

## Repository Template Purpose

- `docs/`
  Holds the PRD, build plans, and any architecture or operational notes.
- `exa_payload_templates/`
  Stores the raw query templates used to build Exa search payloads, one file per retrieval vector.
- `exa_searching/`
  Contains the Exa-first pipeline code for retrieval, mapping, filtering, deduplication, and JSON output.
- `exa_searching/cli.py`
  CLI entrypoint for local execution and debugging.
- `exa_searching/config.py`
  Environment variable loading, constants, and runtime configuration.
- `exa_searching/models.py`
  Pydantic models for seed personas, candidate records, and final batch output.
- `exa_searching/queries.py`
  Query-template loading and seed-persona query rendering.
- `exa_searching/exa.py`
  Exa-specific request and response handling.
- `exa_searching/mapper.py`
  Deterministic logic for turning Exa entities into our internal lead schema.
- `exa_searching/filters.py`
  Qualification, blacklist, and review-flag logic.
- `exa_searching/dedupe.py`
  LinkedIn normalization and duplicate resolution logic.
- `exa_searching/store.py`
  Local JSON read, merge, and write behavior for final leads.
- `exa_searching/runner.py`
  The top-level orchestration function or class that executes the pipeline end to end.
- `data/`
  Local runtime output folder for JSON artifacts produced by `exa_searching/`, including Exa results, mapped records, and final leads.
- `data/leads.json`
  The MVP JSON lead store for final accepted records, with `public_business_email` intentionally empty for now.
- `scripts/`
  Helper scripts for local setup, migration, or admin tasks that should not live in runtime code.

## Delivery Phases

### Phase 0: Foundation

- initialize project structure
- add dependency management, linting, and formatting
- define config strategy and environment variable contract
- add query template files for all seven Exa vectors
- use `exa_searching/` as the code folder and `data/` as the output folder

### Phase 1: Core Domain and Query Layer

- implement seed persona schema
- implement final output schema
- implement seven-vector query builder
- load query templates from `exa_payload_templates/*.txt`

### Phase 2: Exa Retrieval and Mapping

- build Exa client wrapper
- execute searches using the templates in `exa_payload_templates/`
- implement request and response normalization
- implement deterministic entity-to-schema mapper
- handle malformed and ambiguous work histories defensively
- write search and mapped artifacts into `data/`

### Phase 3: Qualification Layer

- implement hard filters
- implement founder-owner exception logic
- implement `needs_review` tagging for ambiguous records
- build candidate completeness scoring for dedup tie-breaking

### Phase 4: Persistence and Deduplication

- implement LinkedIn canonicalization
- implement secondary dedup by normalized name and company
- implement JSON repository merge and overwrite rules
- ensure stored output includes only PRD-approved fields
- ensure `public_business_email` is present but `null` for this phase

### Phase 5: Product Interface

- ship CLI command for local runs
- return structured batch output with same-company and similar-company matches
- keep the current implementation local-first rather than API-first

### Phase 6: Hardening

- add logging and failure diagnostics
- add rate-limit and retry handling
- document operational runbook

Formal tests can be added after the first working end-to-end slice is in place.

## Milestones

### Milestone 1

Run a seed persona through query building, Exa retrieval, mapping, filtering, and deduplication, and write the intermediate artifacts into `data/`.

### Milestone 2

Persist cleaned leads locally in `data/leads.json` and support reruns without duplicate writes.

### Milestone 3

Defer email and content enrichment until the Exa-first local pipeline is stable.

## Risks and Mitigations

### Risk: Exa entity coverage is inconsistent

Mitigation:
- build around defensive parsing
- keep fixtures for missing entities and malformed work history
- leave a narrow fallback seam for future selective content extraction

### Risk: Retrieval noise is high

Mitigation:
- keep filters code-based and explicit
- score title families and prefer operator-side roles
- tag borderline records instead of silently accepting them

### Risk: Enrichment cost expands too early

Mitigation:
- defer enrichment entirely until the Exa-first pipeline is stable
- keep `public_business_email` explicitly nullable in the stored schema

### Risk: Local JSON store becomes hard to manage

Mitigation:
- isolate persistence behind a repository interface
- keep file schema stable
- design storage so a later SQLite or Postgres swap is straightforward

## Success Criteria for the First Build Sprint

At the end of the first implementation sprint, we should be able to:

1. submit a valid seed persona
2. generate all applicable Exa query vectors
3. map structured entity data into the target schema
4. filter and deduplicate candidate leads
5. write deterministic Exa artifacts into `data/`
6. write deterministic cleaned outputs to local JSON

## Assumptions

- we are building this module as a local Exa-first pipeline first
- we should optimize for a flat package until growth clearly justifies more folders
- Exa API credentials will be supplied via environment variables
- enrichment provider credentials can be added later when that phase starts
- `public_business_email` will remain `null` during this phase
- a UI is not required to satisfy the MVP acceptance criteria in `docs/PRD.md`
