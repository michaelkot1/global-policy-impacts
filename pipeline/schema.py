"""SQLite schema for the Policy Impact Explorer.

All DDL lives here so every other module can ``import schema`` and call
``schema.create_tables(conn)`` on a fresh or existing database.
"""

import sqlite3

DDL = """
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
-- One row per policy × metric pair: the estimated causal or associative link.
CREATE TABLE IF NOT EXISTS policy_effects (
    id              INTEGER PRIMARY KEY,
    policy_id       INTEGER NOT NULL REFERENCES policies(id),
    metric_id       INTEGER NOT NULL REFERENCES metrics(id),
    mechanism       TEXT,              -- how the policy is expected to affect the metric
    expected_direction TEXT CHECK (expected_direction IN ('increase', 'decrease', 'ambiguous')),
    evidence_tier   TEXT    NOT NULL DEFAULT 'D'
                        CHECK (evidence_tier IN ('A', 'B', 'C', 'D')),
    effect_estimate REAL,              -- point estimate (percent change)
    effect_low      REAL,              -- lower bound of CI
    effect_high     REAL,              -- upper bound of CI
    effect_unit     TEXT,              -- e.g. 'percent', 'MtCO2', 'MtCO2/yr'
    method          TEXT,              -- e.g. 'diff-in-diff', 'synthetic control', 'event study'
    impact_score    REAL CHECK (impact_score BETWEEN -5 AND 5),
    confidence      REAL CHECK (confidence BETWEEN 0 AND 1),
    UNIQUE (policy_id, metric_id)
);
CREATE INDEX IF NOT EXISTS idx_pe_policy ON policy_effects(policy_id);
CREATE INDEX IF NOT EXISTS idx_pe_metric ON policy_effects(metric_id);

-- ── Policy-effect ↔ citation link ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS policy_effect_citations (
    policy_effect_id INTEGER NOT NULL REFERENCES policy_effects(id),
    citation_id      INTEGER NOT NULL REFERENCES citations(id),
    PRIMARY KEY (policy_effect_id, citation_id)
);
"""


def create_tables(conn: sqlite3.Connection) -> None:
    """Execute all DDL statements on *conn*, enabling WAL and foreign keys."""
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(DDL)
