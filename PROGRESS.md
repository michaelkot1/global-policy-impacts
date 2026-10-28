# Progress Log

One entry per completed plan to-do, newest first. Each entry has a 2–3 sentence overview of what was completed and, if applicable, bullet points of issues hit along the way.

---

## 2026-10-28 · ingest-co2

Implemented `pipeline/sources/eia_co2.py` with three public functions — `fetch()`, `validate()`, `load()` — that ingest EIA state CO₂ emissions data. The primary path uses the EIA API v2 (`co2-emissions/co2-emissions-aggregates`) with paginated fetches and saves raw JSON to `data/raw/`; the fallback downloads six Excel spreadsheets from the EIA website (Table 1 for the full 1970–2022 time series of totals, Tables 2–3 for single-year sector and fuel breakdowns). Validation confirms the sum of state totals matches the US total within 1 % for every year; the pipeline loads 3,172 observations (52 jurisdictions × 53 years for totals, plus 2022 sector/fuel breakdowns) into the database via `build_db.py`.

**Issues**

- Without an `EIA_API_KEY` in `.env`, only the spreadsheet fallback runs. The API provides full sector and fuel breakdowns for all years, whereas the spreadsheets only carry sector/fuel detail for the latest year (2022). Setting up a free API key is recommended for complete data.
- EIA spreadsheet Tables 4–6 turned out to be different metrics (per-capita, energy intensity, carbon intensity) rather than sector-specific CO₂ emissions; the initial table-to-sector mapping was wrong and had to be corrected. Tables 4–6 are now intentionally skipped.
- The spreadsheet "Total of states" row label was not in the initial name-to-abbreviation map; it was added to recognise the US total for validation.

---

## 2026-10-28 · schema

Defined the full SQLite schema across 10 tables (`jurisdictions`, `metrics`, `observations`, `policies`, `policy_applicability`, `policy_effects`, `sources`, `citations`, plus join tables `metric_sources` and `policy_effect_citations`) in `pipeline/schema.py`, with CHECK constraints, foreign keys, unique constraints and 10 indexes. Created `pipeline/seed.py` to populate the US country row, all 50 states + DC with FIPS codes, the three core data sources (EIA, Census, BEA) and the v1 CO2 metric with its source link. Updated `pipeline/build_db.py` to create the database from scratch by calling `schema.create_tables()` then `seed.seed_all()`, printing a summary (52 jurisdictions, 3 sources, 1 metric).

---

## 2026-10-28 · repo-setup

Initialized the git repo with a root `.gitignore` covering `data/raw/`, `.env`, `node_modules/`, `.next/` and Python caches, and pushed `main` to [michaelkot1/global-policy-impacts](https://github.com/michaelkot1/global-policy-impacts). Scaffolded `pipeline/` as a uv project with stub modules for each data source, the policy loader, the event study and `build_db.py`, and scaffolded `web/` as a Next.js app (TypeScript, App Router, Tailwind) with `better-sqlite3`, `recharts`, `d3-geo` and `us-atlas` installed.

**Issues**

- The GitHub CLI wasn't logged in, so pushing required a one-time browser device login (`gh auth login --web`).
- npm warns that Node v23.11 is outside the engine range of `eslint-visitor-keys` (wants `^22.13` or `>=24`). Installs work, but switching to Node 22 LTS or 24 would silence it.
- uv picked up the Anaconda Python (3.13.9) rather than a uv-managed one; the project requires Python `>=3.12`, so this works but is worth knowing if environments differ.
