# SmartSentryAI Warm Outreach Research Pipeline

This package builds a CLI-first research and drafting pipeline for warm outbound outreach.

It takes already-enriched B2B lead rows and produces:

- persona classification
- grounded research queries
- retrieved public evidence
- a safe evidence summary
- a warm outreach email
- deterministic validation flags for review

## What It Does

The pipeline researches:

- company context
- public crime and safety context
- role-specific physical security relevance

It then writes a short email for a human-reviewed outreach workflow.

## What It Does NOT Do

- It does not enrich people or profiles.
- It does not guess emails.
- It does not scrape LinkedIn.
- It does not search for personal contact details.
- It does not make unsupported crime claims.
- It does not claim a company experienced incidents unless public evidence explicitly supports that.

## Why Search APIs + LLM

Search APIs retrieve the evidence.
The LLM only classifies, summarizes, and writes from the provided lead data and retrieved search results.

That keeps the workflow more grounded and easier to audit.

## Setup

1. Create a virtual environment and install dependencies.

```bash
cd warm_outreach
python3 -m venv .venv
source .venv/bin/activate
pip install -e .[dev]
```

2. Copy `.env.example` to `.env`.

```bash
cp .env.example .env
```

3. Set environment variables:

- `OPENAI_API_KEY`
- `TAVILY_API_KEY`

## Run One Lead

```bash
python -m warm_outreach.cli run-one \
  --lead-json '{"name":"Diego Flores","email":"sample@tesla.com","company":"Tesla","location":"Bay Area","linkedin":"https://www.linkedin.com/in/sample","role":"Staff Construction Manager","years_at_role":"2"}'
```

## Run CSV

```bash
python -m warm_outreach.cli run-csv \
  --input examples/leads_sample.csv \
  --output outputs/outreach.jsonl
```

## Optional Flags

- `--max-results 5`
- `--include-raw-content`
- `--dry-run-searches`

## Safety Rules

- Do not guess emails.
- Do not enrich people.
- Do not scrape LinkedIn.
- Do not include personal emails, phone numbers, home addresses, family info, or protected characteristics.
- Do not make unsupported crime claims.
- Always preserve source URLs.
- Default to `human_review` when evidence is weak.

## Persona Guidance

- Construction and facilities: prefer site visibility, after-hours monitoring, trespass, equipment or vehicle protection, and incident review.
- Asset protection and loss prevention: prefer shrink, theft, repeat incidents, investigation workflows, store safety, and incident review.
- Operations: prefer multi-site visibility, incident consistency, response workflows, and operational efficiency.

## Tests

```bash
pytest
```
