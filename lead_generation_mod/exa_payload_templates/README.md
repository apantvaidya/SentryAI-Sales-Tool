# Exa Payload Templates

This folder stores one plain-text query template per Exa retrieval strategy.

## Purpose

- keeps search prompts outside runtime code
- makes retrieval logic easier to review and tune
- lets the query builder load templates by file name and fill placeholders at runtime
- makes adding or removing queries a file-only change

## File Naming

Every active `.txt` file is discovered automatically. Use:

```text
<stable_id>_<descriptive_name>.txt
```

The stable ID can be numeric or textual, but it must be unique. Existing run artifacts keep their saved query definitions, so renaming or removing a template only affects future runs.

Names beginning with `same_company` are assigned to the `same_company` bucket. All other names use `similar_company`. Templates containing `{{linkedin_url}}` are automatically skipped when the seed has no LinkedIn URL.

## Placeholders

- `{{company_name}}`
- `{{role}}`
- `{{person_name}}`
- `{{linkedin_url}}`
- `{{target_industry}}`
- `{{target_location}}`

The query builder replaces these placeholders with the current seed persona values and skips LinkedIn-based templates when no LinkedIn URL is available. `{{target_industry}}` falls back to `the same industry` when not provided, and `{{target_location}}` falls back to `the same target geography`.

## File Guide

- `01_same_company_exact_or_near_role.txt`
  Finds peers and close title variants at the same company.
- `02_same_company_adjacent_leadership.txt`
  Finds nearby leadership roles at the same company in related operating functions.
- `03_same_company_person_anchored_similarity.txt`
  Uses the seed person as the anchor to find same-company people with similar responsibilities.
- `04_similar_company_exact_or_near_role.txt`
  Finds close title matches at comparable companies.
- `05_similar_company_adjacent_role_family.txt`
  Broadens similar-company search into related role families.
- `06_linkedin_anchored_similarity.txt`
  Uses the seed LinkedIn profile as a direct similarity anchor.
- `07_linkedin_anchored_similarity_with_company_expansion.txt`
  Uses the seed LinkedIn profile to find both same-company peers and similar-company lookalikes.
