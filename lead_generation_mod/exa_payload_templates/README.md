# Exa Payload Templates

This folder stores one plain-text query template per Exa retrieval vector from the PRD.

## Purpose

- keeps search prompts outside runtime code
- makes retrieval logic easier to review and tune
- lets the query builder load templates by file name and fill placeholders at runtime

## Placeholders

- `{{company_name}}`
- `{{role}}`
- `{{person_name}}`
- `{{linkedin_url}}`

The query builder should replace these placeholders with the current seed persona values and skip the LinkedIn-based templates when no LinkedIn URL is available.

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
