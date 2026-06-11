# Product Requirements Document (PRD)

## Module: Lookalike Lead Generation Pipeline (Exa Entity Engine MVP)

---

## 1. Executive Summary & Objective

This module is a programmatic lookalike prospecting engine for `SmartSentryAI`. It takes a single pre-qualified buyer or champion (the `Seed Persona`) and discovers additional relevant leads at the same company and at similar companies.

The MVP is optimized for:
- `fast retrieval`
- `low compute cost`
- `deterministic parsing`
- `strict filtering`
- `contact enrichment after lead qualification`

### MVP Design Principle

The MVP does **not** rely on deep page crawling or LLM-based page reading for primary extraction.

Instead, it uses:

1. `Exa people search` as the primary candidate discovery layer
2. `Deterministic entity mapping` from Exa’s structured `entities` payload
3. `Code-based filtering and deduplication`
4. `Email enrichment after lead qualification`
5. `Local JSON file storage` for final cleaned lead records

### Non-Goals for MVP

The MVP does not aim to:
- infer hidden information not supported by Exa entity output
- guarantee a work email for every candidate
- replace downstream human review for ambiguous personas
- perform custom outreach copy generation

If structured Exa entity coverage proves insufficient, the system may later support a fallback path using `contents` retrieval and selective LLM extraction for unresolved records only.

---

## 2. System Architecture

The pipeline follows a synchronous linear architecture that prioritizes cheap cleanup before expensive enrichment.

```text
[Seed Persona Input]
         │
         ▼
[Exa 7-Vector People Retrieval]
         │
         ▼
[Structured Entity Mapper]
         │
         ▼
[Deterministic Role Filter]
         │
         ▼
[Local Deduplication Check]
         │
         ▼
[Waterfall Contact Enrichment]
         │
         ▼
[Final Local JSON Lead Store]
```

### Architecture Principles

- `Retrieval` should be broad enough to discover relevant candidates
- `Filtering` should remove obvious junk before enrichment
- `Enrichment` should be reserved for qualified leads only
- `Only final cleaned person data` should be persisted in the MVP

---

## 3. Input & Output Models

## 3.1 Seed Persona Input

| Field | Type | Required | Example |
| --- | --- | --- | --- |
| `person_name` | string | yes | Joseph Cervantes |
| `role` | string | yes | District 4 Asset Protection Manager |
| `company_name` | string | yes | Vallarta Supermarkets |
| `linkedin_url` | string (URI) | no | `https://www.linkedin.com/in/joseph-cervantes-6712572bb` |

## 3.2 Final Module Output

This schema represents the final output of the module after:
- Exa retrieval
- structured entity mapping
- filtering
- deduplication
- contact enrichment attempts

```json
{
  "title": "PersonaLeadBatch",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "seed_person",
    "same_company_matches",
    "similar_company_matches"
  ],
  "properties": {
    "seed_person": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "person_name",
        "role",
        "company_name"
      ],
      "properties": {
        "person_name": { "type": "string" },
        "role": { "type": "string" },
        "company_name": { "type": "string" },
        "linkedin_url": { "type": ["string", "null"], "format": "uri" }
      }
    },
    "same_company_matches": {
      "type": "array",
      "items": { "$ref": "#/$defs/personaLeadRecord" }
    },
    "similar_company_matches": {
      "type": "array",
      "items": { "$ref": "#/$defs/personaLeadRecord" }
    }
  },
  "$defs": {
    "personaLeadRecord": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "full_name",
        "current_title",
        "current_company",
        "years_at_current_role",
        "resolved_location",
        "linkedin_url",
        "public_business_email"
      ],
      "properties": {
        "full_name": { "type": ["string", "null"] },
        "current_title": { "type": ["string", "null"] },
        "current_company": { "type": ["string", "null"] },
        "years_at_current_role": {
          "type": ["number", "null"],
          "minimum": 0
        },
        "resolved_location": {
          "type": ["string", "null"]
        },
        "linkedin_url": {
          "type": ["string", "null"],
          "format": "uri"
        },
        "public_business_email": {
          "type": ["string", "null"]
        }
      }
    }
  }
}
```

---

## 4. Exa Discovery Layer

## 4.1 Exa Search Configuration

The MVP uses Exa `category = "people"` as the primary retrieval mechanism.

### Baseline Payload

```json
{
  "query": "...",
  "category": "people",
  "type": "auto",
  "numResults": 20
}
```

### Notes

- `people` is the preferred category for person/profile retrieval
- We should not depend on undocumented Exa behavior
- Domain restrictions may be tested experimentally, but the MVP should work without assuming they are always valid or always beneficial
- Raw Exa responses do not need to be stored persistently in the MVP

---

## 5. Query Strategy

The system builds `7` query vectors for each seed persona.

### Shared Query Suffix

Append to every query:

`Prefer profiles where the current role, company, tenure, and location are clearly visible.`

### Vector 1: Same-Company Exact/Near-Role

```text
people at {{company_name}} with current roles similar to {{role}}, including managers, directors, district, regional, and senior asset protection, loss prevention, physical security, and store operations roles
```

### Vector 2: Same-Company Adjacent Leadership

```text
current employees at {{company_name}} in asset protection, loss prevention, physical security, district security, regional operations, facilities, or store leadership roles related to {{role}}
```

### Vector 3: Same-Company Person-Anchored Similarity

```text
people at {{company_name}} with responsibilities similar to {{person_name}}, especially in asset protection, loss prevention, physical security, district leadership, or store operations
```

### Vector 4: Similar-Company Exact/Near-Role

```text
people at companies similar to {{company_name}} with current roles similar to {{role}}, especially in grocery, supermarket, retail, or other multi-site physical operations businesses
```

### Vector 5: Similar-Company Adjacent Role Family

```text
current employees at companies similar to {{company_name}} in asset protection, loss prevention, physical security, district operations, facilities, or store leadership roles related to {{role}}
```

### Vector 6: LinkedIn-Anchored Similarity

```text
people similar to this profile in current role, seniority, and responsibilities: {{linkedin_url}}
```

### Vector 7: LinkedIn-Anchored Similarity with Company Expansion

```text
people similar to this profile, including same-company peers and comparable leaders at similar multi-site retail or grocery companies: {{linkedin_url}}
```

### Query Strategy Rules

- Run all applicable vectors
- If `linkedin_url` is absent, skip vectors 6 and 7
- Merge all returned results before deduplication

---

## 6. Deterministic Entity Mapping

The MVP uses Exa `results[].entities[].properties` as the primary source of truth.

## 6.1 Current Role Selection Rules

For each result:
1. If no `entities` exist, discard the result
2. Use `entities[0].properties`
3. Identify `current_job` as the best work-history entry by this priority:
   - first entry where `dates.to == null`
   - among concurrent current roles, prefer non-empty `title` and `company.name`
   - prefer buyer-side operator/security roles over advisory, board, or side projects
   - if no active role exists, use the most recent dated role
4. If no reasonable current role can be determined, mark record as invalid

## 6.2 Mapping Logic

```python
from datetime import datetime, timezone

def map_exa_entity_to_schema(result_node):
    if not result_node.get("entities"):
        return None

    props = result_node["entities"][0].get("properties", {})
    work_history = props.get("workHistory", []) or []

    current_roles = [
        job for job in work_history
        if (job.get("dates") or {}).get("to") is None
    ]

    def role_quality(job):
        title = (job.get("title") or "").strip()
        company = ((job.get("company") or {}).get("name") or "").strip()
        score = 0
        if title:
            score += 1
        if company:
            score += 1
        title_lc = title.lower()
        if any(term in title_lc for term in [
            "asset protection", "loss prevention", "security",
            "operations", "facilities", "shrink"
        ]):
            score += 1
        if any(term in title_lc for term in [
            "advisor", "board", "consultant", "fractional"
        ]):
            score -= 1
        return score

    current_job = None
    if current_roles:
        current_job = sorted(current_roles, key=role_quality, reverse=True)[0]
    elif work_history:
        current_job = work_history[0]

    if not current_job:
        return None

    years_at_role = None
    start_str = (current_job.get("dates") or {}).get("from")
    if start_str:
        try:
            start_date = datetime.strptime(start_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            years_at_role = round((datetime.now(timezone.utc) - start_date).days / 365.25, 2)
        except Exception:
            years_at_role = None

    role_location = current_job.get("location")
    fallback_location = props.get("location")
    resolved_location = role_location or fallback_location

    return {
        "full_name": props.get("name"),
        "current_title": current_job.get("title"),
        "current_company": (current_job.get("company") or {}).get("name"),
        "years_at_current_role": years_at_role,
        "resolved_location": resolved_location,
        "linkedin_url": result_node.get("url")
    }
```

### 6.3 Location Rule

The system should resolve location in this order:
1. location attached to the current work-history entry
2. general profile/entity location

Only the final `resolved_location` value needs to be kept in stored output.

---

## 7. Filtering Layer

The filtering layer eliminates obvious noise before enrichment.

## 7.1 Hard Requirements

Drop the record if:
- `full_name` is missing
- `current_title` is missing
- `current_company` is missing
- `linkedin_url` is missing

## 7.2 Blacklist Rule

Drop the record if `current_title` contains:
- `recruiter`
- `talent acquisition`
- `consultant`
- `advisor`
- `sales`
- `account manager`
- `account executive`
- `vendor`
- `business development`
- `sdr`
- `bdr`
- `journalist`
- `student`

Drop `founder`, `ceo`, or `owner` unless the seed persona is also in that class.

## 7.3 Review Rule

Mark as `needs_review` rather than auto-dropping if:
- the title is borderline relevant
- the company is hard to classify
- the role appears concurrent or ambiguous

---

## 8. Deduplication

## 8.1 Primary Dedup Key

Canonicalized `linkedin_url`

Normalization rules:
- lowercase host
- strip query parameters
- normalize trailing slash
- preserve stable `/in/` identity path

## 8.2 Secondary Dedup Key

Normalized:
- `full_name`
- `current_company`

## 8.3 Tertiary Dedup Heuristic

If both are highly similar:
- normalized name
- same company cluster
- same title family

keep the more complete record.

---

## 9. Contact Enrichment

Contact enrichment happens only after qualification and deduplication.

## 9.1 Waterfall Strategy

```text
[Qualified Lead]
      │
      ▼
[Aggregator Enrichment]
      │
      ▼
[Premium Finder]
      │
      ▼
[Optional Heuristic Guessing]
      │
      ▼
[Final Person Record]
```

## 9.2 Tier 1: Aggregator Enrichment

Examples:
- Apollo
- Datagma
- People Data Labs
- Dropcontact

Inputs:
- `full_name`
- `current_company`
- `linkedin_url`

## 9.3 Tier 2: Premium Finder

Examples:
- Findymail
- Hunter

Use only if tier 1 does not yield a business email.

## 9.4 Tier 3: Optional Heuristic Guessing

Only generate email permutations if:
- company domain is confidently known
- aggregator and premium providers failed

## 9.5 Email Output Rule

The module should store:
- found work email if available
- `null` if no work email is found

No verification stage is required in this MVP.

---

## 10. Local JSON Storage

The MVP stores final lead records locally in a JSON file, which acts as the database for this phase of development.

## 10.1 Stored Fields

Only the final cleaned person data should be stored:
- `full_name`
- `public_business_email`
- `current_company`
- `resolved_location`
- `linkedin_url`
- `current_title`
- `years_at_current_role`

No intermediate retrieval, mapping, filter, or audit records need to be persisted in the MVP.

## 10.2 Local File Behavior

- Store output in a local JSON file
- Append newly accepted, deduplicated leads
- Use canonicalized `linkedin_url` as the primary dedup key before writing
- If `linkedin_url` is missing, fall back to normalized `full_name + current_company`
- Overwrite an existing record only if the new record has more complete data

## 10.3 Example Stored Record

```json
{
  "full_name": "Joseph Cervantes",
  "public_business_email": null,
  "current_company": "Vallarta Supermarkets",
  "resolved_location": "Bakersfield, California, United States",
  "linkedin_url": "https://www.linkedin.com/in/joseph-cervantes-6712572bb",
  "current_title": "District 4 Asset Protection Manager",
  "years_at_current_role": 2.14
}
```

---

## 11. Failure Modes

The system must handle:

- no Exa results
- Exa results with no entities
- malformed or incomplete work-history
- multiple active roles
- missing company or title
- excessive recruiter/vendor noise
- duplicate records across vectors
- no contact found
- company domain unknown
- enrichment provider failure

---

## 12. MVP Acceptance Criteria

The MVP is successful if it can:

1. Accept a valid seed persona
2. Execute all applicable Exa query vectors
3. Deterministically map structured entity fields into the schema
4. Filter obvious junk without LLM assistance
5. Deduplicate candidates
6. Enrich qualified candidates with contact attempts
7. Store final cleaned person records locally in a JSON file
8. Produce useful same-company and similar-company lead sets at reasonable cost