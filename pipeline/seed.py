"""Seed data: US jurisdiction, 50 states + DC, the CO2 metric, and core sources.

Call ``seed_all(conn)`` after the schema tables exist.
"""

import sqlite3

# ── US states + DC with FIPS codes ──────────────────────────────────────
# (FIPS code, abbreviation/ISO-3166-2, full name)
US_STATES: list[tuple[str, str, str]] = [
    ("01", "AL", "Alabama"),
    ("02", "AK", "Alaska"),
    ("04", "AZ", "Arizona"),
    ("05", "AR", "Arkansas"),
    ("06", "CA", "California"),
    ("08", "CO", "Colorado"),
    ("09", "CT", "Connecticut"),
    ("10", "DE", "Delaware"),
    ("11", "DC", "District of Columbia"),
    ("12", "FL", "Florida"),
    ("13", "GA", "Georgia"),
    ("15", "HI", "Hawaii"),
    ("16", "ID", "Idaho"),
    ("17", "IL", "Illinois"),
    ("18", "IN", "Indiana"),
    ("19", "IA", "Iowa"),
    ("20", "KS", "Kansas"),
    ("21", "KY", "Kentucky"),
    ("22", "LA", "Louisiana"),
    ("23", "ME", "Maine"),
    ("24", "MD", "Maryland"),
    ("25", "MA", "Massachusetts"),
    ("26", "MI", "Michigan"),
    ("27", "MN", "Minnesota"),
    ("28", "MS", "Mississippi"),
    ("29", "MO", "Missouri"),
    ("30", "MT", "Montana"),
    ("31", "NE", "Nebraska"),
    ("32", "NV", "Nevada"),
    ("33", "NH", "New Hampshire"),
    ("34", "NJ", "New Jersey"),
    ("35", "NM", "New Mexico"),
    ("36", "NY", "New York"),
    ("37", "NC", "North Carolina"),
    ("38", "ND", "North Dakota"),
    ("39", "OH", "Ohio"),
    ("40", "OK", "Oklahoma"),
    ("41", "OR", "Oregon"),
    ("42", "PA", "Pennsylvania"),
    ("44", "RI", "Rhode Island"),
    ("45", "SC", "South Carolina"),
    ("46", "SD", "South Dakota"),
    ("47", "TN", "Tennessee"),
    ("48", "TX", "Texas"),
    ("49", "UT", "Utah"),
    ("50", "VT", "Vermont"),
    ("51", "VA", "Virginia"),
    ("53", "WA", "Washington"),
    ("54", "WV", "West Virginia"),
    ("55", "WI", "Wisconsin"),
    ("56", "WY", "Wyoming"),
]


def seed_jurisdictions(conn: sqlite3.Connection) -> int:
    """Insert the US and its 50 states + DC.  Returns the US jurisdiction id."""
    cur = conn.execute(
        "INSERT OR IGNORE INTO jurisdictions (type, parent_id, name, code, iso_code) "
        "VALUES ('country', NULL, 'United States', 'US', 'US')"
    )
    us_id: int = cur.lastrowid or conn.execute(
        "SELECT id FROM jurisdictions WHERE code = 'US' AND type = 'country'"
    ).fetchone()[0]

    conn.executemany(
        "INSERT OR IGNORE INTO jurisdictions (type, parent_id, name, code) "
        "VALUES ('state', ?, ?, ?)",
        [(us_id, name, fips) for fips, _abbr, name in US_STATES],
    )
    return us_id


def seed_sources(conn: sqlite3.Connection) -> dict[str, int]:
    """Insert the core data sources and return a ``{name: id}`` mapping."""
    rows = [
        (
            "EIA State CO2 Emissions",
            "U.S. Energy Information Administration",
            "https://www.eia.gov/environment/emissions/state/",
            None,
            "Annual state-level energy-related CO2 emissions by sector and fuel",
        ),
        (
            "Census Population Estimates",
            "U.S. Census Bureau",
            "https://www.census.gov/programs-surveys/popest.html",
            None,
            "Intercensal and annual state population estimates, 1970–present",
        ),
        (
            "BEA State GDP",
            "Bureau of Economic Analysis",
            "https://www.bea.gov/data/gdp/gdp-state",
            None,
            "State GDP from SAGDP (1997–) and SQGDP (earlier years)",
        ),
    ]

    mapping: dict[str, int] = {}
    for name, publisher, url, doi, description in rows:
        cur = conn.execute(
            "INSERT OR IGNORE INTO sources (name, publisher, url, doi, description) "
            "VALUES (?, ?, ?, ?, ?)",
            (name, publisher, url, doi, description),
        )
        row_id = cur.lastrowid or conn.execute(
            "SELECT id FROM sources WHERE name = ?", (name,)
        ).fetchone()[0]
        mapping[name] = row_id

    return mapping


def seed_metrics(conn: sqlite3.Connection, source_ids: dict[str, int]) -> None:
    """Insert the v1 CO2 metric and link it to the EIA source."""
    cur = conn.execute(
        "INSERT OR IGNORE INTO metrics "
        "(slug, name, unit, definition, methodology, "
        " higher_is_better, allow_total, allow_per_capita, allow_per_gdp) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            "co2",
            "Energy-Related CO2 Emissions",
            "million metric tons CO2",
            "Annual energy-related carbon dioxide emissions by state, "
            "broken down by sector (residential, commercial, industrial, "
            "transportation, electric power) and fuel type.",
            "Sourced from EIA State Energy-Related CO2 Emissions tables. "
            "Sum-of-states validated against the national total each year "
            "(pipeline fails on >1% discrepancy).",
            0,  # lower is better
            1,  # allow_total
            1,  # allow_per_capita
            1,  # allow_per_gdp
        ),
    )
    metric_id = cur.lastrowid or conn.execute(
        "SELECT id FROM metrics WHERE slug = 'co2'"
    ).fetchone()[0]

    eia_source_id = source_ids["EIA State CO2 Emissions"]
    conn.execute(
        "INSERT OR IGNORE INTO metric_sources (metric_id, source_id) VALUES (?, ?)",
        (metric_id, eia_source_id),
    )


def seed_all(conn: sqlite3.Connection) -> None:
    """Run every seed function inside a single transaction."""
    with conn:
        seed_jurisdictions(conn)
        src_ids = seed_sources(conn)
        seed_metrics(conn, src_ids)
