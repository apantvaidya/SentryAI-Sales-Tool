# PRD: Deep-Context AI Profiling Scraper API

> Source-of-truth requirements document. Captured verbatim from the original
> brief so `DESIGN.md` and `PLAN.md` have a stable reference. Edits to scope
> belong here first.

## 1. Product Overview

The Deep-Context AI Profiling Scraper is an API-driven, agentic extraction
engine. Its primary objective is to build high-fidelity, highly contextualized
profiles of target individuals to enable hyper-personalized cold outreach.

Unlike traditional pattern-matching scrapers, this system uses an orchestrator
AI agent to dynamically determine the best sources (LinkedIn, company "About"
pages, news articles, personal blogs), navigate them, and extract semantic
meaning rather than relying on brittle HTML selectors.

## 2. API Specification

The system will operate via a RESTful API or gRPC endpoint.

### 2.1 Inputs (Payload)

The system must handle dynamic, sparse inputs. At minimum, it requires a name
and a company or a primary URL.

| Field          | Type          | Requirement | Description                                                                       |
| -------------- | ------------- | ----------- | --------------------------------------------------------------------------------- |
| `target_name`  | String        | Required    | Full name of the prospect.                                                        |
| `company_name` | String        | Optional    | Current employer.                                                                 |
| `seed_urls`    | Array[String] | Optional    | Known URLs (e.g., LinkedIn profile, personal website, Twitter).                   |
| `context_goal` | String        | Optional    | The specific product/service we are pitching, used to align the extraction lens.  |

### 2.2 Output Schema

```json
{
  "profile": {
    "personal": { "name": "", "exact_location": "", "interests": [] },
    "professional": {
      "title": "",
      "company": "",
      "responsibilities": [],
      "reports_to": "",
      "oversees": [],
      "cost_metrics": "Estimated budget control or department size"
    },
    "contact": {
      "best_channels": [],
      "emails": [],
      "social_links": []
    },
    "outreach_strategy": {
      "pain_points": [],
      "how_we_benefit_them": ""
    }
  },
  "metadata": {
    "sources_used": [],
    "confidence_score": 0.92
  }
}
```

## 3. System Architecture & Agent Workflow

Multi-Agent Orchestration (LangGraph / CrewAI):

1. **Planner Agent** — receives payload, runs targeted SERP query, picks 3–5
   highest-yield URLs.
2. **Scraping Engine** — fetches raw HTML/content from identified URLs.
3. **Distiller (Heuristic Parser)** — strips boilerplate, converts DOM to
   Markdown (e.g., Crawl4AI).
4. **Extraction Agent** — LLM maps distilled Markdown to the JSON schema and
   synthesizes the "how we benefit them" narrative.

## 4. Efficiency & Token Optimization Rules

- **DOM Distillation** — never pass raw HTML to the LLM; strip CSS, scripts,
  non-content nodes; emit Markdown.
- **Semantic Chunking** — for long documents, chunk and use a local embedding
  model to surface only chunks relevant to the target's name/role before LLM
  extraction.
- **Limit HTTP via SERP** — no open-ended crawler; use a SERP API with queries
  like `"[Name]" "[Company]" responsibilities site:linkedin.com OR site:company.com`.

## 5. Anti-Bot & Evasion Infrastructure

> **Critical:** Do **not** use a commercial VPN. Datacenter IPs are flagged
> instantly by Cloudflare / PerimeterX / Datadome.

- **Rotating Residential Proxies** — Bright Data / Smartproxy / SOAX; rotate
  per request or session.
- **Headless Browser Escalation** — start with static HTML; escalate to
  Playwright/Puppeteer with stealth on 403, challenge pages, or JS-required
  content.
- **Header Fingerprinting** — randomize `User-Agent`, `Accept-Language`,
  `Referer`, and matched client hints.

## 6. Compliance & Privacy Boundaries

- Suppression list + data lifecycle policy.
- GDPR / CCPA adherence for PII at scale.
- Agents must ignore sensitive personal data (health, family members, financial
  records) and stay strictly in B2B professional context.
