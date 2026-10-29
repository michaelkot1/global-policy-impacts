# Progress Log

One entry per completed plan to-do, newest first. Each entry has a 2–3 sentence overview of what was completed and, if applicable, bullet points of issues hit along the way.

---

## 2026-10-28 · web-policies

Built `/policies` (a filterable catalog of all 31 policies: search, level, status, evidence tier, a "quantified only" box and five sorts, kept in the URL), `/policies/[slug]` (all 31 prerendered) and `/methodology`. A policy page shows its evidence rows, the event-study chart and robustness checks behind each tier-B row, a timeline of which states it covered and when, and its citations; the methodology page defines the metrics, normalizations, tiers, impact score, confidence and this site's own estimator, with counts read live from `app.db`. State pages now link each policy title to its `/policies/[slug]` page, and the shared effect and tier components moved to `src/components/evidence.tsx` and `src/lib/effects-data.ts` so both page types show the same rows. `tsc`, `eslint` and `next build` pass, and I checked the catalog filters and sorts, RGGI, the state RPS record, the Acid Rain Program and the methodology page in a browser.

**Issues**

- The RPS record's `summary` in the YAML contains authoring notes ("`jurisdiction: US` stands for 'many states'...", "these end dates should be checked against the latest Berkeley Lab data"). They show verbatim on the catalog (clamped to three lines) and the policy page. I did not edit the catalog; that text should move to `notes` or be rewritten as a reader-facing summary. The RGGI summary similarly mentions "no applicability rows" for Pennsylvania.
- Several applicability notes say things like "participation continuous through 2026-10-28" (the date the pipeline ran). They display as written, under "Notes on the dates".
- Catalog coverage is "N states over time": states that joined, left or returned count once, so RGGI reads "11 states over time" though nine were members throughout. The catalog sorts and filters on the first row only for "Largest estimated effect" (the published row when there is one) but the tier filter matches any row, so RGGI appears under both A and B. Both are stated on the page.
- "Largest estimated effect" puts policies with no quantified estimate last, and the page says "not estimated" is not "no effect". The only tier D policy with a number is the IRA (a modelled projection); it sorts beside tier A and C rows by size, so use "Strongest evidence" to rank by tier first.
- The methodology page says "the pre-trend test rejects for 3 of the 4 estimates" and similar counts from `app.db`, but the rest of its text (the score bins, the confidence rubric and rule, the tier A rule) is copied by hand from `pipeline/policies/scoring.py`, the loader and `event_study.py`. If those change, the page text has to be changed too. The Borusyak, Jaravel and Spiess link on the methodology page uses the DOI stored in the catalog's citation record (10.1093/restud/rdae007).
- Federal laws apply to every state in the same window, so no tier A or B can come from this site for them. The policy page says so, in cautious wording because the Acid Rain Program covers 49 jurisdictions, not 51.
- Unknown slugs such as `/policies/narnia` render the not-found page but return HTTP 200, for the same Cache Components reason as the state pages.
- The "Research and data behind the effect estimates" list on a tier-B policy includes the EIA, Census, BEA and Borusyak et al. citations the estimator row carries, so it mixes data sources with research.
- No site navigation exists yet; the three new pages link to each other, to the state pages and to `/metrics/co2`, and the policy pages are reachable from the state pages. There are no automated tests.
- I did not touch the uncommitted `.env.example` change or the untracked `data/app.db-shm` and `-wal` files.

---

## 2026-10-28 · web-state

Built `/states/[state]` (slugs like `california`, `district-of-columbia`; all 51 are prerendered). Each page has three headline figures (total, per capita, per GDP, with rank and change since 1990 and 2005), a stacked sector chart with a Total / Per capita / Per GDP toggle, dashed markers for the year each policy starts to apply (numbered to match the list), a rank-history chart, and a filterable list of the policies that applied to the state with their dates, status, evidence tier, impact score, confidence and citations. The ranking table and the state panel on `/metrics/co2` now link to the state pages. `tsc`, `eslint` and `next build` pass, and I checked New Jersey, California and DC in a browser (toggle, per-GDP gap before 1997, hover highlight of a policy's span).

**Issues**

- A policy is attached to a state if it has an applicability row for the state or for the United States (that is how federal laws and the Paris Agreement are stored). Markers are drawn at the calendar year of each period's start date, so a policy effective in December sits on that year's point. Policies that start after 2022 (for example California's ACC II rule and some RGGI re-entries) appear in the list but have no marker.
- The effect estimates shown on a state page are for the policy's whole study sample (all RGGI states, or the states that adopted an RPS), not for that state alone, and the page says so. Where a policy has both a published and a tier-B row, the published row is first, then this site's own estimates with power-sector before per capita. Tier-B rows show the pre-trend p-value, and a warning when it is below 0.10 (three of the four are), because those estimates probably overstate the effect.
- Policies with `unquantified` basis show "Effect on CO₂ not estimated. This is not the same as no effect." and their score is not displayed. Catalog "low/high" values are labelled "range across specifications", and only event-study rows are labelled "95% interval", as the evidence entry required.
- Marker labels crowd where many federal laws start in the same few years (1990 and 2021–2022); the label collapses to a range like "13–17" and the tooltip lists them. There are 17 to 23 markers per state, so the chart is busy, and I have not tried a lane layout.
- Policy titles link to each policy's official URL, not to `/policies/[id]`, because that page does not exist yet. Swap them when the catalog pages land.
- With Cache Components, an unknown slug such as `/states/narnia` renders the 404 page but the HTTP status is 200, because the page streams inside `<Suspense>` (needed so `params` is not read outside it). A real 404 status would need a runtime check outside the page, or a different structure.
- The rank chart is zoomed to the state's own range (best rank minus 2 to worst plus 2), so a flat line for a state that never moves can look more dramatic than it is; read the y-axis labels. Ranks use all 51 jurisdictions including DC and are ties-share-the-best-rank.
- The page ships one state's data (about 170 KB of HTML with the policy list), which is fine, but every policy's citations are included whether or not the details panel is opened.
- There is no `/states` index page, so state pages are reached from the rankings table, the state panel, or by URL. The root layout still has no navigation. Browser testing with the browser tool's accessibility snapshot injects `data-cursor-ref` attributes that cause hydration warnings in dev; they are not from the app, but running `next dev` and `next build` at the same time broke the production assets once, so I rebuilt from a clean `.next`.
- No automated tests; I checked rank values and the NJ and CA figures by eye (California 2nd of 51 in total since the 1970s, 2022 total 326 Mt) and not against an independent calculation.

---

## 2026-10-28 · web-rankings

Built `/metrics/co2` in the Next.js app: a state choropleth (us-atlas, drawn with d3-geo), a sortable ranking table with change since 1990 and 2005, a year slider (1970–2022, with play/pause), a Total / Per capita / Per GDP toggle driven by the metric's `allow_*` flags, a sector filter, a selected-state history chart, and a sources and method section linking to EIA, Census and BEA. The server reads `data/app.db` once (`src/lib/db.ts`, `src/lib/co2-data.ts`, cached with `use cache`) and the client recomputes values, ranks and colour classes instantly; the view is kept in the URL (`?norm=&sector=&year=&state=`) so it can be shared. `tsc`, `eslint` and `next build` pass, and I checked the page in a browser (toggle, slider, play, map click, per-GDP year clamp).

**Issues**

- The page embeds the whole dataset (51 states × 53 years × 6 sectors, plus population and GDP) so the controls respond without a round trip. That makes the HTML about 695 KB (about 256 KB gzipped), because Next sends the data both in the markup and in the client payload. I rounded values and map paths to cut it; moving the data to a cached JSON route handler would shrink it further if load time matters.
- Per GDP uses BEA GDP in current dollars and starts in 1997, so the slider range becomes 1997–2022 for that measure and the figures fall partly because prices rise. The page says so; the requested year is restored if you switch back to another measure. Population is interpolated before 2000 (per the metric's methodology note).
- Colour classes are quantiles of every state-year value for the chosen sector and measure (not of the single year shown), so colours stay comparable while the slider moves. A state's colour therefore says "high or low across 1970–2022", not "top fifth this year"; the rank column and table give the within-year ordering.
- The United States figure shown is the sum of the 50 states and DC, not the stored US row, so all three measures use the same basis. State names are not yet links because `/states/[state]` does not exist yet; selecting a state shows an in-page history chart instead.
- Hawaii and Alaska appear in the Albers inset layout, and DC is too small to click on the map, so it has an invisible larger hit area; keyboard users get the same data through the table (the map is a labelled image, not tab stops).
- Opening `data/app.db` read-only creates `app.db-shm` and `app.db-wal` next to it because the pipeline leaves the database in WAL mode. They are untracked and I did not commit or ignore them; they may need adding to `.gitignore`. The root layout metadata is still the "Create Next App" default and there is no site navigation yet, so I only set the page's own title.
- There are no automated tests for the page or the normalization maths; I checked values by eye (United States 2022 total 4,934 Mt, Texas first) and not against an independent calculation.

---

## 2026-10-28 · event-study

Implemented `pipeline/analysis/event_study.py`: a staggered difference-in-differences (the Borusyak–Jaravel–Spiess imputation estimator, with state and year fixed effects and a log-population control) for state RPS and RGGI, run on two outcomes (electric-power-sector CO₂ and total CO₂ per capita). It writes four tier-B rows to `policy_effects` with 95 % bootstrap intervals, impact scores and confidence, plus year-by-year event-time coefficients (`policy_effect_event_time`) and diagnostics (`policy_effect_checks`: pre-trend test, randomisation-inference p-value, four robustness specifications), and `build_db.py` now runs it after the catalog loads. The headline results are RGGI −29.9 % power-sector CO₂ (CI −40.8 to −12.0) and −10.0 % CO₂ per capita, and RPS −5.9 % power-sector CO₂ (CI −13.7 to +3.4, not significant) and −5.4 % per capita; the published rows (RGGI −19.4 % tier A, RPS −12.5 % tier C) are kept beside them.

**Issues**

- The pre-trend test rejects for three of the four headline models (RGGI power p=0.08, RGGI per capita p<0.01, RPS per capita p=0.01; only RPS power passes, p=0.30). Treated states were already drifting down relative to controls before adoption, so these estimates probably overstate the policy effect. The rubric therefore gives them confidence 0.35 to 0.40, and the web app must show tier, confidence and the pre-trend p-value next to the number. The RGGI power figure scores +5 only because −29.9 % is past the 20 % bin edge.
- I changed the headline specification after seeing the first run: the full 1970–2022 panel failed the pre-trend test everywhere (p ≤ 0.007), so the headline window is now 1990–2022 (the window of the published RPS and RGGI studies). The 1970–2022 result is stored as `robust:since_1970` and is larger in every case (for example RGGI power −37.7 %). State-specific linear trends were tried and rejected because they extrapolate the 1970–2008 slope and give lead coefficients of +20 to +35 %. This is a data-informed choice, so treat the pre-trend p-values as descriptive and not as a clean test.
- The plan asks for GDP controls. BEA GDP starts in 1997, so GDP is a robustness check (`robust:gdp_controls`, only cohorts adopting from 2000) and not the headline, which controls for log population only. GDP can also respond to the policy, which makes it a poor control.
- Schema change (needed because policy_effects was UNIQUE(policy_id, metric_id)): `policy_effects` gained `estimate_source` (`catalog` or `event_study`) and `outcome` (`co2_power`, `co2_per_capita`, NULL for catalog rows), uniqueness moved to an index on `(policy_id, metric_id, estimate_source, outcome)`, and `schema.create_tables` upgrades an older database in place. A policy can now have a published row and several tier-B rows, so the web app has to choose which to show first; the plan says published first, and for these two policies the power-sector row is the like-for-like comparison. The loader no longer skips a catalog row when a tier-B row exists. The RPS record's mechanism text in the YAML still says "until this site's own event study is run"; I did not edit the catalog.
- Samples: Iowa and Minnesota (RPS adopted 1983 and 1994, too few pre-years) and Kansas (RPS 2009–2015) and New Jersey (RGGI, left 2012–2019) are dropped from the headline; Kansas and New Jersey are back, treated from first adoption, in `robust:include_reversals`. California (own cap-and-trade) is not used as an RGGI control and Virginia (2020 Clean Economy Act) not as an RPS control. The power-sector outcome also drops DC, ID, OR, VT and WA, whose power CO₂ is near zero in some years (a log is undefined there), so Vermont (RGGI) and Oregon, Washington and DC (RPS) are not in those models. The per-capita models keep every state.
- RGGI has only nine treated states in the power model. Bootstrap intervals with that few treated clusters can be too narrow, which is why the randomisation-inference p-value is also stored; it is bounded below by 1/1000.
- RPS start years are the Berkeley Lab enactment year, which for several states is earlier than the binding standard (flagged in the catalog notes), so event time 0 is imprecise there and effects are likely attenuated. Likewise RGGI starts in 2009, the year of the recession, and most RGGI states also have an RPS.
- The `confidence` values come from a fixed rule in the module (0.5, minus 0.15 for a rejected pre-trend test, 0.15 for a sign flip in any check, 0.10 for randomisation p above 0.10). It is my judgement call, so please review it.
- Checked the estimator on 40 simulated panels with known staggered, growing effects: the mean error was about 0 (−0.0003 log points) and all 40 intervals covered the truth. There is no automated test in the repo.
- I left the uncommitted `.env.example` change out of this commit, as before.

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
