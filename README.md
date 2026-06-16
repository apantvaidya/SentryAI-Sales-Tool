# Smart Sentry Sales Intelligence MVP

A local-first Next.js MVP for high-quality Smart Sentry prospect research and reviewed outreach drafting.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

## Environment

Copy `.env.example` to `.env.local` (or `.env`).

```bash
OPENAI_API_KEY=
TAVILY_API_KEY=
```

When `OPENAI_API_KEY` is absent, the app runs in demo mode and returns high-quality mock research, contact scoring, and outreach drafts. No keys are hardcoded.

`.env.example` also covers the Python subprocess modules below — they inherit this root environment, so a single file is enough for the whole repo.

The People tab's warm outreach pipeline is a separate Python package under [warm_outreach](/Users/aran/code/SentryAI-Sales-Tool/warm_outreach). For live crime research and email generation, it also needs a local virtualenv and the Tavily key:

```bash
cd warm_outreach
python3 -m venv .venv
./.venv/bin/pip install -e .[dev]
```

## Storage

This MVP uses a local JSON store at `data/db.json`, created automatically on first use. It is intentionally small and easy to migrate.

To migrate to Supabase:

1. Create tables matching the TypeScript models in `lib/data/types.ts`.
2. Replace the functions in `lib/data/store.ts` with Supabase client calls.
3. Keep server actions in `app/actions.ts` unchanged where possible.
4. Add row-level security and user ownership before production use.

## Compliance Notes

Smart Sentry does not send automated email from this app. Contacts are manual or placeholder records, unverified emails are labelled, and drafts require review before copy/export.
