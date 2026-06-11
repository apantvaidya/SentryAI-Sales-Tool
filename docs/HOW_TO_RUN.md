# How To Run

## 1. Create Your Environment File

Copy the example file:

```bash
cp .env.example .env
```

Then open `.env` and set:

```env
EXA_API_KEY=your_real_exa_api_key
```

Notes:

- the code automatically loads `.env` from the repo root
- if `.env` is missing, the CLI will fail with a setup error

## 2. Create a Seed Persona JSON File

Create a file like `seed.json` in the repo root:

```json
{
  "person_name": "Joseph Cervantes",
  "role": "District 4 Asset Protection Manager",
  "company_name": "Vallarta Supermarkets",
  "linkedin_url": "https://www.linkedin.com/in/joseph-cervantes-6712572bb"
}
```

Required fields:

- `person_name`
- `role`
- `company_name`

Optional field:

- `linkedin_url`

If `linkedin_url` is missing, any active query template containing `{{linkedin_url}}` is skipped automatically.

## 3. Run The CLI

From the repo root, run:

```bash
python3 -m exa_searching.cli run-seed --input seed.json
```

Optional:

```bash
python3 -m exa_searching.cli run-seed --input seed.json --num-results 10 --print-batch
```

Options:

- `--num-results`
  Overrides the default Exa result count for that run
- `--print-batch`
  Includes the final batch payload in stdout

## 4. What The Pipeline Does

The current MVP flow is:

1. load the query templates from `exa_payload_templates/*.txt`
2. render the templates using the seed persona
3. call the Exa people search API
4. map `results[].entities[0].properties`
5. filter obvious noise
6. deduplicate candidates
7. write JSON artifacts into `data/`
8. write final accepted leads into `data/leads.json`

For this phase:

- `public_business_email` is always `null`
- email enrichment is not implemented yet

## 5. Output Files

The run writes JSON files into [data](/Users/aran/code/SentryAI-Sales-Tool/lead_generation_mod/data), including:

- `exa_run_<timestamp>_queries.json`
- `exa_run_<timestamp>_exa_results.json`
- `exa_run_<timestamp>_mapped_candidates.json`
- `exa_run_<timestamp>_unmapped_results.json`
- `exa_run_<timestamp>_filter_decisions.json`
- `exa_run_<timestamp>_review_candidates.json`
- `exa_run_<timestamp>_batch.json`
- `exa_run_<timestamp>_run_summary.json`

Final accepted leads are merged into:

- [leads.json](/Users/aran/code/SentryAI-Sales-Tool/lead_generation_mod/data/leads.json)

## 6. Common Errors

### Missing `.env`

You will see an error telling you to copy `.env.example` to `.env`.

Fix:

```bash
cp .env.example .env
```

### Missing `EXA_API_KEY`

The Exa client will fail before making live searches.

Fix:

Add your real key to `.env`:

```env
EXA_API_KEY=your_real_exa_api_key
```

### Missing Seed File

If the input file path is wrong, the CLI will fail with a file-not-found error.

Fix:

Make sure your command points to a real JSON file:

```bash
python3 -m exa_searching.cli run-seed --input seed.json
```

## 7. Current Limitations

- no email enrichment yet
- no API server yet
- no automated tests yet
- structured entity mapping depends on Exa returning usable `entities`
