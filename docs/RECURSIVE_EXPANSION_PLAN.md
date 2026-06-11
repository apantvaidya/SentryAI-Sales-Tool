# Recursive Expansion Plan

## Goal

Allow a user to specify a single seed persona and a target total profile count `N`. The system runs the standard 7-vector pipeline on the seed, selects one result as the next seed, and repeats until `N` unique leads have been collected or no viable pivot candidate exists.

---

## Concept

```
[Original Seed Persona]
         │
         ▼
[Run standard pipeline → PersonaLeadBatch]
         │
         ▼
[Score similar_company_matches → pick pivot]
         │
         ▼
[Pivot becomes new SeedPersona]
         │
         ▼
[Repeat until N leads collected or no pivot found]
```

Each hop produces a `RunResult`. All results are merged into a single deduplicated lead store. The pivot is chosen deterministically from `similar_company_matches` only — same-company results are never used as pivots because the current company is already being mined.

---

## Pivot Scoring

The pivot selector scores every candidate in `similar_company_matches` and picks the highest scorer.

### Score Formula

```
score = company_novelty_bonus
      + role_fidelity_score
      + completeness_score
      + years_bonus
      - query_frequency_penalty
```

### Component Details

**`company_novelty_bonus`** — `10` if the candidate's company has not yet been used as a seed in this expansion run, `0` otherwise. This is the dominant signal; without it the search loops inside the same company cluster.

**`role_fidelity_score`** — `0–3`. Measures how closely the candidate's title matches the **original** seed's role string (not the intermediate pivot's role). Uses the same keyword matching already in `mapper.py`:
- `+1` for each matched positive term from `POSITIVE_ROLE_TERMS` (asset protection, loss prevention, security, operations, facilities, shrink), capped at `2`
- `-1` if any negative term from `NEGATIVE_ROLE_TERMS` (advisor, board, consultant, fractional) is present
- Score is clamped to `[0, 3]`

Anchoring to the original seed prevents persona drift across hops (e.g., gradually drifting from AP managers to IT directors).

**`completeness_score`** — `0–3`. A sparse profile makes a poor search anchor for the next hop.
- `+1` if `linkedin_url` is present
- `+1` if `current_title` is present
- `+1` if `current_company` is present

**`years_bonus`** — `min(years_at_current_role, 5) * 0.1`. Tiebreaker only. Long-tenured profiles tend to have more stable, discoverable data.

**`query_frequency_penalty`** — `query_hit_count * 2`. Penalises candidates who appeared in many of the 7 query vectors. A candidate who was returned by 5 vectors is already well-represented in the current batch; pivoting to them would likely produce diminishing returns. See "Query Hit Count Tracking" below.

---

## Query Hit Count Tracking

Currently `MappedCandidate` records only `source_vector_id` — the single vector from which the candidate was first mapped. After deduplication, the count of how many vectors returned a given candidate is lost.

### Required Change: `dedupe.py`

When `dedupe_records()` merges duplicates, it must also sum the vector hit counts. The winning (most complete) record should have its `query_hit_count` set to the total number of duplicate appearances before dedup.

### Required Change: `models.py` — `MappedCandidate`

Add one field:

```python
query_hit_count: int = 1
```

Default is `1` (the candidate was returned by at least one vector). After dedup merging this reflects the true total.

---

## New Module: `pivot.py`

Location: `lead_generation_mod/exa_searching/pivot.py`

Responsibilities:
- implement `score_pivot_candidate(candidate, original_seed_role, seen_companies)` → `float`
- implement `select_pivot(similar_company_matches, original_seed_role, seen_companies)` → `PersonaLeadRecord | None`
- convert a `PersonaLeadRecord` into a `SeedPersona` for the next hop

### `select_pivot` Logic

```python
def select_pivot(
    similar_company_matches: list[PersonaLeadRecord],
    original_seed_role: str,
    seen_companies: set[str],
) -> PersonaLeadRecord | None:
    scored = [
        (score_pivot_candidate(r, original_seed_role, seen_companies), r)
        for r in similar_company_matches
        if r.linkedin_url  # must have a URL to anchor next search
    ]
    if not scored:
        return None
    return max(scored, key=lambda x: x[0])[1]
```

### Converting a `PersonaLeadRecord` to `SeedPersona`

```python
def lead_record_to_seed(record: PersonaLeadRecord) -> SeedPersona:
    return SeedPersona(
        person_name=record.full_name,
        role=record.current_title,
        company_name=record.current_company,
        linkedin_url=record.linkedin_url,
    )
```

---

## New Model: `ExpansionResult` in `models.py`

```python
@dataclass(frozen=True)
class ExpansionResult:
    original_seed: SeedPersona
    target_count: int
    hop_results: list[RunResult]          # one per seed pivot
    pivot_trail: list[SeedPersona]        # seeds used at each hop (including original)
    total_leads_collected: int
    stopped_reason: str                   # "target_reached" | "no_pivot_found" | "max_hops_reached"
```

`hop_results` preserves the full per-hop artifacts so individual runs can still be inspected.

---

## New Method: `LeadGenerationRunner.run_expansion()` in `runner.py`

```python
def run_expansion(
    self,
    original_seed: SeedPersona,
    target_count: int,
    max_hops: int = 20,
) -> ExpansionResult:
```

### Algorithm

```
seen_companies = {normalize(original_seed.company_name)}
pivot_trail = [original_seed]
hop_results = []
current_seed = original_seed
original_role = original_seed.role

while leads_collected < target_count and hops < max_hops:
    result = self.run(current_seed)
    hop_results.append(result)
    leads_collected = count unique leads in leads.json

    pivot = select_pivot(
        result.batch.similar_company_matches,
        original_role,
        seen_companies,
    )
    if pivot is None:
        stopped_reason = "no_pivot_found"
        break

    seen_companies.add(normalize(pivot.current_company))
    current_seed = lead_record_to_seed(pivot)
    pivot_trail.append(current_seed)

return ExpansionResult(...)
```

`leads_collected` is read from the live `leads.json` count after each hop's `persist_leads()` call so deduplication across hops is automatically respected — we never double-count a lead that appeared in multiple hops.

---

## CLI Changes: `cli.py`

Add a new subcommand `run-expand` alongside the existing `run-seed`:

```
python3 -m exa_searching.cli run-expand --input seed.json --total 100
```

Options:
- `--input` — path to seed persona JSON (same format as `run-seed`)
- `--total` — target number of unique leads to collect
- `--max-hops` — safety ceiling on recursion depth (default `20`)
- `--num-results` — override Exa result count per hop
- `--print-batch` — include all hop batches in stdout

---

## Artifact Changes

Each hop already writes its own timestamped artifacts to `data/`. The expansion run adds one additional file:

`data/expansion_<timestamp>_<company_slug>_<person_slug>_summary.json`

Contents:
```json
{
  "original_seed": { ... },
  "target_count": 100,
  "total_leads_collected": 87,
  "stopped_reason": "no_pivot_found",
  "hops": 12,
  "pivot_trail": [
    { "person_name": "...", "company_name": "...", "role": "..." },
    ...
  ],
  "hop_run_ids": ["exa_2026-06-10_...", ...]
}
```

---

## Build Order

### Step 1 — `models.py`
Add `query_hit_count: int = 1` to `MappedCandidate`. Add `ExpansionResult` dataclass.

### Step 2 — `dedupe.py`
When merging duplicate candidates, accumulate `query_hit_count` into the winning record.

### Step 3 — `pivot.py`
Implement `score_pivot_candidate`, `select_pivot`, and `lead_record_to_seed`.

### Step 4 — `runner.py`
Add `run_expansion()` method to `LeadGenerationRunner`.

### Step 5 — `cli.py`
Add `run-expand` subcommand and `handle_run_expand` handler.

### Step 6 — Verify
Dry-run with a real seed persona and `--total 10` to confirm pivot trail, dedup counts, and artifact output are correct. Check that `query_hit_count` is populated and that the penalty is working by inspecting scored candidates in the expansion summary.

---

## Failure Modes to Handle

- `similar_company_matches` is empty on the first hop → stop with `no_pivot_found`
- All similar-company candidates have already-seen companies → the novelty bonus is `0` for all; the selector still picks the best remaining candidate rather than halting prematurely
- A `PersonaLeadRecord` has a null `full_name` or `current_title` → `lead_record_to_seed` should raise a clear error so the expansion stops gracefully rather than sending a malformed seed to Exa
- `max_hops` exceeded → stop with `stopped_reason = "max_hops_reached"` and return what was collected
