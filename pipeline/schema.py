"""SQLite schema for the Policy Impact Explorer.

All DDL lives here so every other module can ``import schema`` and call
``schema.create_tables(conn)`` on a fresh or existing database.
"""

import sqlite3

POLICY_EFFECTS_DDL = """
CREATE TABLE IF NOT EXISTS policy_effects (
    id              INTEGER PRIMARY KEY,
    policy_id       INTEGER NOT NULL REFERENCES policies(id),
    metric_id       INTEGER NOT NULL REFERENCES metrics(id),
    mechanism       TEXT,              -- how the policy is expected to affect the metric
    scope           TEXT,              -- what the estimate is measured on, e.g. 'electric-power-sector CO2, RGGI states'
    expected_direction TEXT CHECK (expected_direction IN ('increase', 'decrease', 'ambiguous')),
    evidence_tier   TEXT    NOT NULL DEFAULT 'D'
                        CHECK (evidence_tier IN ('A', 'B', 'C', 'D')),
    effect_estimate REAL,              -- point estimate (percent change)
    effect_low      REAL,              -- lower bound: the CI where the source reports one, else the
                                       -- range across specifications (the 'method' text says which).
                                       -- Event-study (tier B) rows always hold a 95% CI.
    effect_high     REAL,              -- upper bound, as for effect_low
    effect_unit     TEXT,              -- e.g. 'percent', 'MtCO2', 'MtCO2/yr'
    method          TEXT,              -- e.g. 'diff-in-diff', 'synthetic control', 'event study'
    -- Size of effect on a -5..+5 scale (pipeline/policies/scoring.py). Every link has one;
    -- 'score_basis' says what it rests on, and 0 with basis 'unquantified' means "no
    -- quantified effect", NOT "no effect".
    impact_score    REAL    NOT NULL CHECK (impact_score BETWEEN -5 AND 5),
    score_basis     TEXT    NOT NULL DEFAULT 'unquantified'
                        CHECK (score_basis IN ('estimate', 'projection', 'never_bound', 'unquantified')),
    confidence      REAL CHECK (confidence BETWEEN 0 AND 1),  -- trust in the estimate; NULL if none
    -- Where the row comes from: the YAML catalog or this site's own event study.
    estimate_source TEXT    NOT NULL DEFAULT 'catalog' CHECK (estimate_source IN ('catalog', 'event_study')),
    -- Which measure of the metric an event-study row is about ('co2_power', 'co2_per_capita');
    -- NULL for catalog rows.
    outcome         TEXT
);
"""

_DDL_TEMPLATE = """
-- ── Jurisdictions ──────────────────────────────────────────────────────
-- Countries, states, provinces.  Hierarchical via parent_id.
CREATE TABLE IF NOT EXISTS jurisdictions (
    id          INTEGER PRIMARY KEY,
    type        TEXT    NOT NULL CHECK (type IN ('country', 'state', 'province', 'territory')),
    parent_id   INTEGER REFERENCES jurisdictions(id),
    name        TEXT    NOT NULL,
    code        TEXT,            -- FIPS code for US states, ISO-3166 for countries
    iso_code    TEXT,            -- ISO-3166-1 alpha-2 for countries
    UNIQUE (type, code)
);
CREATE INDEX IF NOT EXISTS idx_jurisdictions_parent ON jurisdictions(parent_id);
CREATE INDEX IF NOT EXISTS idx_jurisdictions_code   ON jurisdictions(code);

-- ── Sources ────────────────────────────────────────────────────────────
-- External data sources (EIA, Census, BEA, academic papers, etc.)
CREATE TABLE IF NOT EXISTS sources (
    id              INTEGER PRIMARY KEY,
    name            TEXT    NOT NULL,
    publisher       TEXT,
    url             TEXT,
    doi             TEXT,
    date_accessed   TEXT,          -- ISO-8601 date
    description     TEXT
);

-- ── Metrics ────────────────────────────────────────────────────────────
-- Each measurable quantity (CO2, population, GDP, etc.)
CREATE TABLE IF NOT EXISTS metrics (
    id              INTEGER PRIMARY KEY,
    slug            TEXT    NOT NULL UNIQUE,   -- URL-friendly key, e.g. 'co2'
    name            TEXT    NOT NULL,
    unit            TEXT    NOT NULL,
    definition      TEXT,
    methodology     TEXT,
    higher_is_better INTEGER NOT NULL DEFAULT 0,  -- boolean: 0 = lower is better
    allow_total     INTEGER NOT NULL DEFAULT 1,
    allow_per_capita INTEGER NOT NULL DEFAULT 0,
    allow_per_gdp   INTEGER NOT NULL DEFAULT 0
);

-- ── Metric–Source link ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS metric_sources (
    metric_id   INTEGER NOT NULL REFERENCES metrics(id),
    source_id   INTEGER NOT NULL REFERENCES sources(id),
    PRIMARY KEY (metric_id, source_id)
);

-- ── Observations ───────────────────────────────────────────────────────
-- Time-series data: one row per jurisdiction × metric × year (× sector).
CREATE TABLE IF NOT EXISTS observations (
    id              INTEGER PRIMARY KEY,
    jurisdiction_id INTEGER NOT NULL REFERENCES jurisdictions(id),
    metric_id       INTEGER NOT NULL REFERENCES metrics(id),
    year            INTEGER NOT NULL,
    value           REAL,
    sector          TEXT,          -- e.g. 'residential', 'commercial', 'transportation', etc.
    source_id       INTEGER REFERENCES sources(id),
    UNIQUE (jurisdiction_id, metric_id, year, sector)
);
CREATE INDEX IF NOT EXISTS idx_obs_jur_metric ON observations(jurisdiction_id, metric_id);
CREATE INDEX IF NOT EXISTS idx_obs_year       ON observations(year);

-- ── Policies ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS policies (
    id              INTEGER PRIMARY KEY,
    slug            TEXT    NOT NULL UNIQUE,   -- URL-friendly key
    title           TEXT    NOT NULL,
    kind            TEXT    NOT NULL CHECK (kind IN (
                        'federal_law', 'executive_order', 'regulation',
                        'state_law', 'interstate_program', 'international_agreement'
                    )),
    level           TEXT    NOT NULL CHECK (level IN ('federal', 'state', 'interstate', 'international')),
    jurisdiction_id INTEGER NOT NULL REFERENCES jurisdictions(id),  -- issuing jurisdiction
    enacted_date    TEXT,          -- ISO-8601
    effective_date  TEXT,
    repealed_date   TEXT,
    status          TEXT    NOT NULL DEFAULT 'enacted'
                        CHECK (status IN ('enacted', 'repealed', 'blocked', 'expired', 'pending')),
    summary         TEXT,
    official_url    TEXT
);
CREATE INDEX IF NOT EXISTS idx_policies_kind  ON policies(kind);
CREATE INDEX IF NOT EXISTS idx_policies_level ON policies(level);

-- ── Policy applicability ───────────────────────────────────────────────
-- Which jurisdictions a policy applies to and over what date range.
-- Handles states joining/leaving RGGI, federal rules blocked by courts, etc.
CREATE TABLE IF NOT EXISTS policy_applicability (
    id              INTEGER PRIMARY KEY,
    policy_id       INTEGER NOT NULL REFERENCES policies(id),
    jurisdiction_id INTEGER NOT NULL REFERENCES jurisdictions(id),
    start_date      TEXT,          -- ISO-8601, NULL = from enactment
    end_date        TEXT,          -- NULL = still in effect
    notes           TEXT
);
CREATE INDEX IF NOT EXISTS idx_pa_policy ON policy_applicability(policy_id);
CREATE INDEX IF NOT EXISTS idx_pa_jur    ON policy_applicability(jurisdiction_id);

-- ── Citations ──────────────────────────────────────────────────────────
-- Individual reference entries that can be linked to policy effects.
CREATE TABLE IF NOT EXISTS citations (
    id          INTEGER PRIMARY KEY,
    source_id   INTEGER REFERENCES sources(id),
    title       TEXT    NOT NULL,
    authors     TEXT,
    year        INTEGER,
    doi         TEXT,
    url         TEXT,
    accessed    TEXT               -- ISO-8601 date
);

-- ── Policy effects ─────────────────────────────────────────────────────
-- Links between a policy and a metric. Published or hand-assessed links come from the YAML
-- catalog (estimate_source 'catalog', one per policy and metric). The site's own tier-B
-- event-study estimates (estimate_source 'event_study') sit beside them, one per policy,
-- metric and outcome, so a published estimate is never overwritten by our own.
{POLICY_EFFECTS}
CREATE INDEX IF NOT EXISTS idx_pe_policy ON policy_effects(policy_id);
CREATE INDEX IF NOT EXISTS idx_pe_metric ON policy_effects(metric_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pe_link
    ON policy_effects(policy_id, metric_id, estimate_source, COALESCE(outcome, ''));

-- ── Event-study detail (tier-B rows only) ──────────────────────────────
-- Year-by-year effects around adoption, in percent change, for the event-study chart.
-- event_time 0 is the first full calendar year the policy applied; negative values are the
-- pre-adoption "lead" placebo coefficients that the pre-trend test looks at.
CREATE TABLE IF NOT EXISTS policy_effect_event_time (
    policy_effect_id INTEGER NOT NULL REFERENCES policy_effects(id),
    event_time      INTEGER NOT NULL,
    estimate        REAL    NOT NULL,   -- percent change
    low             REAL,               -- 95% bootstrap CI, percent change
    high            REAL,
    n_states        INTEGER NOT NULL,   -- treated states contributing at this event time
    PRIMARY KEY (policy_effect_id, event_time)
);

-- Diagnostics and robustness checks behind a tier-B estimate: the headline sample, the
-- pre-trend test, a randomisation-inference p-value and the estimate under alternative
-- specifications. estimate/low/high are percent change; p_value applies to the check itself.
CREATE TABLE IF NOT EXISTS policy_effect_checks (
    id              INTEGER PRIMARY KEY,
    policy_effect_id INTEGER NOT NULL REFERENCES policy_effects(id),
    check_name      TEXT    NOT NULL,
    description     TEXT,
    estimate        REAL,
    low             REAL,
    high            REAL,
    p_value         REAL,
    n_treated       INTEGER,
    n_control       INTEGER,
    n_obs           INTEGER,
    UNIQUE (policy_effect_id, check_name)
);

-- ── Policy ↔ citation link ─────────────────────────────────────────────
-- Documents that establish the policy itself (statute / rule text, dates,
-- applicability).  Evidence about *effects* is linked via policy_effect_citations.
CREATE TABLE IF NOT EXISTS policy_citations (
    policy_id   INTEGER NOT NULL REFERENCES policies(id),
    citation_id INTEGER NOT NULL REFERENCES citations(id),
    PRIMARY KEY (policy_id, citation_id)
);

-- ── Policy-effect ↔ citation link ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS policy_effect_citations (
    policy_effect_id INTEGER NOT NULL REFERENCES policy_effects(id),
    citation_id      INTEGER NOT NULL REFERENCES citations(id),
    PRIMARY KEY (policy_effect_id, citation_id)
);
"""


DDL = _DDL_TEMPLATE.replace("{POLICY_EFFECTS}", POLICY_EFFECTS_DDL.strip())


def _upgrade_policy_effects(conn: sqlite3.Connection) -> None:
    """Rebuild a pre-event-study ``policy_effects`` table in place.

    The old table was UNIQUE(policy_id, metric_id), which left no room for the site's own
    estimate beside a published one. SQLite cannot drop a table constraint, so the table is
    rebuilt (the documented create / copy / drop / rename procedure) with every row kept
    as a catalog row.
    """
    columns = {row[1] for row in conn.execute("PRAGMA table_info(policy_effects)")}
    if not columns or "estimate_source" in columns:
        return  # no table yet, or already current
    conn.execute("PRAGMA foreign_keys = OFF")
    try:
        with conn:
            conn.execute("DROP TABLE IF EXISTS policy_effects_new")
            conn.execute(
                POLICY_EFFECTS_DDL.replace(
                    "CREATE TABLE IF NOT EXISTS policy_effects", "CREATE TABLE policy_effects_new"
                )
            )
            old_columns = ", ".join(sorted(columns))
            conn.execute(
                f"INSERT INTO policy_effects_new ({old_columns}) SELECT {old_columns} FROM policy_effects"
            )
            conn.execute("DROP TABLE policy_effects")
            conn.execute("ALTER TABLE policy_effects_new RENAME TO policy_effects")
    finally:
        conn.execute("PRAGMA foreign_keys = ON")


def create_tables(conn: sqlite3.Connection) -> None:
    """Execute all DDL statements on *conn*, enabling WAL and foreign keys.

    Safe to call on an existing database: tables are created only if missing, and an old
    ``policy_effects`` table is upgraded first (see :func:`_upgrade_policy_effects`).
    """
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA foreign_keys = ON")
    _upgrade_policy_effects(conn)
    conn.executescript(DDL)
