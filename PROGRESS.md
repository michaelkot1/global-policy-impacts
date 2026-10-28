# Progress Log

One entry per completed plan to-do, newest first. Each entry has a 2–3 sentence overview of what was completed and, if applicable, bullet points of issues hit along the way.

---

## 2026-10-28 · evidence

Added published effect estimates with citations and gave all 31 policy-CO₂ links an evidence tier and an impact score. Two links are tier A: RGGI (−19.4 %, Murray and Maniloff 2015) and a new California Low Carbon Fuel Standard record (−9.85 % of transportation CO₂, Huseynov and Palma 2018); state RPS (tier C, −12.5 %) and the IRA (tier D, −12.5 %, a modelled 2030 projection) also carry estimates. The other 27 links have no quantified effect, so they score 0 with `score_basis` of `unquantified` (24) or `never_bound` (3), and `policy_effects.impact_score` is now NOT NULL.

**Issues**

- A score of 0 with basis `unquantified` means "not estimated", not "no effect". 24 of 31 links are in that state because I found no peer-reviewed CO₂ estimate for them, so the web app must show those as "not estimated" and never rank them as zero-impact. I added `policy_effects.score_basis` (`estimate`, `projection`, `never_bound`, `unquantified`) so this is explicit; the plan's data model did not list it.
- Only two links are tier A, because that is all the literature supports. Close misses: California cap-and-trade stays tier C (Lessmann and Kramer 2024 find power-sector emissions 48 % below a synthetic control but industry 6 % above, say complementary policies drove the power result, and rate it the less robust of the two), and state RPS stays tier C. Greenstone and Nath is now accepted by the Journal of Political Economy Microeconomics but has no journal DOI, so it fails the loader's "tier A needs a peer-reviewed DOI" rule; promote it when the DOI appears. The June 2026 revision narrowed its CO₂ result to 8–17 % (the catalog had 11–24 % from the 2024 draft), and I updated the record.
- The RPS estimate (−12.5 %) is the midpoint of a range across specifications, and `effect_low` and `effect_high` hold that range (and, for LCFS, the range across three methods), not a confidence interval. The schema comment and each `method` text say so, but the web app should not label them "95 % CI" unless the source gave one.
- Loader rules changed: tiers A and B must carry a percent estimate, tier C may, and tier D may only for a modelled projection. An estimate needs unit `percent`, a `method` and a hand-set `confidence` (rubric in `scoring.py`); a policy with no applicability rows cannot carry an estimate. The `confidence` values are my judgement, so please review them (RGGI 0.6, LCFS 0.5, RPS 0.3, IRA 0.15).
- Scores are scoped to what each estimate measures, not rescaled to statewide CO₂: LCFS is transportation CO₂ only, RGGI and RPS are power-sector CO₂, and the IRA figure is all greenhouse gases for 2030. LCFS lands at +3 only because −9.85 % sits just below the 10 % bin edge (the DiD result, −10.95 %, would score +4).
- The IRA projection is for the law as passed in 2022; the 2025 reconciliation law curtailed it, so it likely overstates the current effect.
- MATS has a peer-reviewed estimate of coal burned (6.4 million short tons less, 0.6 % of 2014 production; Coglianese, Gerarden and Stock 2020), but I did not convert it to CO₂ because replacement gas generation is not netted out, so it stays unquantified. It is cited in the record.
- A search result for an RPS "Climatica" paper claiming a 4.3–9.6 % CO₂ intensity cut looked fabricated (the author affiliations are institutes that do not appear to exist), so I did not use it.
- `policy_effects` is still UNIQUE(policy_id, metric_id), so the site's own tier-B event-study row cannot sit beside these published rows; the "show the published estimate first" idea from the plan still needs that schema decision.
- A new LCFS record was added (31 policies, was 30) because it is the only other policy with a clean peer-reviewed estimate. Its enactment date is year precision (2009) because the CARB page gives no day, and amendments after 2016 are not catalogued separately.
- I left the uncommitted `.env.example` change (real API keys in a tracked file, noted in the ingest-co2 entry) out of this commit; those keys should be rotated and moved to `.env`.

---

## 2026-10-28 · policy-catalog

Wrote a hand-curated catalog of 30 policies in `data/policies/*.yaml` (17 federal, 10 state, 1 interstate, 2 international), plus a source registry (`_sources.yaml`, 26 sources) and a citation registry (`_citations.yaml`, ~65 documents with DOIs or official URLs). `pipeline/policies/load.py` validates the whole catalog before writing (all errors reported at once: unknown states, bad dates, overlapping applicability, kind/level mismatches, uncited effects, and evidence-tier rules such as "tier A needs a peer-reviewed citation with a DOI") and then upserts it into SQLite; `build_db.py` now calls it, giving 818 per-state applicability rows. Each policy's CO₂ link carries an evidence tier and at least one citation; only RGGI reaches tier A (−19.4 %, impact score +4, via `pipeline/policies/scoring.py`), and the rest are tier C or D with no numeric estimate.

**Issues**

- `schema.py` gained a nullable `policy_effects.scope` column and a `policy_citations` join table (policy-level sources such as statute text); the plan's data model did not list either.
- `policy_effects` is UNIQUE(policy_id, metric_id), so the site's own event-study (tier B) row cannot coexist with an A/C/D row from YAML for the same policy and metric. The loader skips the YAML row when a tier-B row exists. Whether to keep both needs a schema decision.
- Impact scores exist only for effects with a percent estimate, so only RGGI has one so far. Everything else is unscored until the event-study work produces estimates.
- Evidence tiers are deliberately conservative. California cap-and-trade and state RPS are tier C because attribution is ambiguous or the main paper (Greenstone & Nath) is still a working paper; promote it to tier A once it is published.
- The Berkeley Lab RPS spreadsheet was blocked, so per-state RPS start years (year precision) come from the 2016 LBNL chart. Binding-standard dates that differ (PA, MN, AZ, NM) are flagged in the row notes. The AZ, TX and KS end dates should be re-checked against a primary source.
- Section 177 states for California's ZEV and ACC II rules, and the Phase I states for the Acid Rain Program, are not enumerated; those policies are recorded on California or the 49 non-AK/HI states respectively. Successor vehicle rules are not catalogued.
- Applicability starts follow the date obligations bind (e.g. MATS 2015-04-16, not the 2012 rule date). Policies that never bound (Clean Power Plan, ACE, Kyoto) have no applicability rows. Paris status `repealed` means US participation ended on 2026-01-27. Legal statuses were checked on the web as of 2026-10-28 and may change.
- Interstate, umbrella and international policies use the US row as the issuing jurisdiction because `policies.jurisdiction_id` is NOT NULL.
- I could not verify every URL: some congress.gov and leginfo pages return 403 to scripts, so govinfo equivalents are used where available and `accessed` is left blank for pages I did not open.

---

## 2026-10-28 · ingest-denoms

Implemented `pipeline/sources/census_pop.py` and `pipeline/sources/bea_gdp.py` to ingest Census population (1970–2023) and BEA state GDP (1997–2025). Census population spans six file sources: three modern CSV downloads from Census Bureau (2000–2023), plus three historical files — `st-99-03.txt` for the 1990s, `st8090ts.txt` for the 1980s, and `pe-19.csv` (age × race × sex breakdowns summed to totals) for the 1970s — yielding 2,754 observations (51 jurisdictions × 54 years). BEA GDP uses the Regional API (`SAGDP1`, LineCode 1, all-industry total) with a `BEA_API_KEY` from `.env`, with a CSV-download fallback, yielding 1,479 observations. Updated `seed.py` to register `population` and `gdp` metrics linked to their respective sources, and `build_db.py` to call both new modules. Per-capita and per-GDP CO₂ rankings are now computable by joining on jurisdiction and year.

**Issues**

- The Census Bureau API now requires an API key for all endpoints (including decennial data), so the original approach of fetching 1970–2000 anchor points from `api.census.gov` failed with HTTP 302 redirects to `missing_key.html`. Replaced with direct downloads of archived Census text/CSV files.
- The 2000–2009 intercensal CSV (`st-est00int-alldata.csv`) has demographic breakdowns (SEX, ORIGIN, RACE, AGEGRP) instead of a SUMLEV column. Without filtering to the total rows (all-zero demographic codes), it produced 610K rows instead of 510. Fixed by adding demographic-column filtering.
- Both BEA fallback CSV URLs return HTML pages instead of actual data, so the BEA module requires a valid `BEA_API_KEY` in `.env` (free registration at https://apps.bea.gov/api/signup/).
- The EIA API v2 path in `eia_co2.py` fails with `Cannot specify ',' with 's'.` even with a valid key. This looks like a string-formatting bug (the API returns `total` as a string, and the code formats it with `:,`), but I haven't confirmed or fixed it. It predates this to-do, and CO₂ data still loads via the spreadsheet fallback, so sector and fuel detail is limited to 2022.

---

## 2026-10-28 · ingest-co2

Implemented `pipeline/sources/eia_co2.py` with three public functions — `fetch()`, `validate()`, `load()` — that ingest EIA state CO₂ emissions data. The primary path uses the EIA API v2 (`co2-emissions/co2-emissions-aggregates`) with paginated fetches and saves raw JSON to `data/raw/`; the fallback downloads six Excel spreadsheets from the EIA website (Table 1 for the full 1970–2022 time series of totals, Tables 2–3 for single-year sector and fuel breakdowns). Validation confirms the sum of state totals matches the US total within 1 % for every year; the pipeline loads 3,172 observations (52 jurisdictions × 53 years for totals, plus 2022 sector/fuel breakdowns) into the database via `build_db.py`.

**Issues**

- Without an `EIA_API_KEY` in `.env`, only the spreadsheet fallback runs, and the spreadsheets only carry sector/fuel detail for the latest year (2022). **Follow-up fix:** with the key set, the API path first silently fell back because `total` comes back from EIA as a string (formatting crashed), and industrial rows were dropped because EIA's code is `IC`, not `II`. Both are fixed; the API path now loads 24,804 rows (total, 5 sectors and 3 fuels for all 52 jurisdictions, 1970–2022), and sector sums match the total.
- Real keys were placed in the git-tracked `.env.example`; they should live only in the git-ignored `.env`.
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
