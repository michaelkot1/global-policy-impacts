"""Fetch state population estimates from the Census Bureau.

Primary path
    Download population-estimate files published on the Census Bureau
    website, spanning 1970 to the latest available year:

    * **2020–present:** ``NST-EST20XX-ALLDATA.csv`` — wide CSV with
      ``POPESTIMATE{year}`` columns and ``SUMLEV`` / ``STATE`` fields.
    * **2010–2019:** ``nst-est2020-alldata.csv`` (vintage 2020).
    * **2000–2009:** ``st-est00int-alldata.csv`` (2000-2010 intercensal,
      demographic breakdown filtered to totals).
    * **1990–1999:** ``stch-icen{year}.txt`` (1990-2000 intercensal county
      files, summed to states; same series EIA uses for per-capita emissions).
    * **1980–1990:** ``st8090ts.txt`` (state-abbreviation rows, year
      columns, two blocks).
    * **1970–1979:** ``pe-19.csv`` (age × race × sex CSV; summed across
      all demographic groups to get total population).

The public interface has two functions that ``build_db`` calls::

    df = fetch()         # returns a normalised DataFrame
    load(conn, df)       # inserts into the observations table
"""

from __future__ import annotations

import io
import logging
import math
import re
import sqlite3
from pathlib import Path
from typing import Any

import httpx
import pandas as pd

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent.parent.parent
RAW_DIR = ROOT / "data" / "raw"

# FIPS codes for the 50 states + DC
_VALID_FIPS: set[str] = {
    "01", "02", "04", "05", "06", "08", "09", "10", "11", "12",
    "13", "15", "16", "17", "18", "19", "20", "21", "22", "23",
    "24", "25", "26", "27", "28", "29", "30", "31", "32", "33",
    "34", "35", "36", "37", "38", "39", "40", "41", "42", "44",
    "45", "46", "47", "48", "49", "50", "51", "53", "54", "55", "56",
}

# State abbreviation → FIPS code (used by the 1980s file)
_ABBR_TO_FIPS: dict[str, str] = {
    "AL": "01", "AK": "02", "AZ": "04", "AR": "05", "CA": "06",
    "CO": "08", "CT": "09", "DE": "10", "DC": "11", "FL": "12",
    "GA": "13", "HI": "15", "ID": "16", "IL": "17", "IN": "18",
    "IA": "19", "KS": "20", "KY": "21", "LA": "22", "ME": "23",
    "MD": "24", "MA": "25", "MI": "26", "MN": "27", "MS": "28",
    "MO": "29", "MT": "30", "NE": "31", "NV": "32", "NH": "33",
    "NJ": "34", "NM": "35", "NY": "36", "NC": "37", "ND": "38",
    "OH": "39", "OK": "40", "OR": "41", "PA": "42", "RI": "44",
    "SC": "45", "SD": "46", "TN": "47", "TX": "48", "UT": "49",
    "VT": "50", "VA": "51", "WA": "53", "WV": "54", "WI": "55",
    "WY": "56",
}

# State name → FIPS code (used by the 1990s file)
_NAME_TO_FIPS: dict[str, str] = {
    "alabama": "01", "alaska": "02", "arizona": "04", "arkansas": "05",
    "california": "06", "colorado": "08", "connecticut": "09",
    "delaware": "10", "district of columbia": "11", "florida": "12",
    "georgia": "13", "hawaii": "15", "idaho": "16", "illinois": "17",
    "indiana": "18", "iowa": "19", "kansas": "20", "kentucky": "21",
    "louisiana": "22", "maine": "23", "maryland": "24",
    "massachusetts": "25", "michigan": "26", "minnesota": "27",
    "mississippi": "28", "missouri": "29", "montana": "30",
    "nebraska": "31", "nevada": "32", "new hampshire": "33",
    "new jersey": "34", "new mexico": "35", "new york": "36",
    "north carolina": "37", "north dakota": "38", "ohio": "39",
    "oklahoma": "40", "oregon": "41", "pennsylvania": "42",
    "rhode island": "44", "south carolina": "45", "south dakota": "46",
    "tennessee": "47", "texas": "48", "utah": "49", "vermont": "50",
    "virginia": "51", "washington": "53", "west virginia": "54",
    "wisconsin": "55", "wyoming": "56",
}

# ── File URLs ───────────────────────────────────────────────────────────

# Modern CSV files (2000-present) — newest vintage first.
_MODERN_FILES: list[dict[str, Any]] = [
    {
        "url": (
            "https://www2.census.gov/programs-surveys/popest/"
            "datasets/2020-2023/state/totals/NST-EST2023-ALLDATA.csv"
        ),
        "dest": "census_pop_2020s.csv",
        "years": list(range(2020, 2024)),
    },
    {
        "url": (
            "https://www2.census.gov/programs-surveys/popest/"
            "datasets/2010-2020/state/totals/nst-est2020-alldata.csv"
        ),
        "dest": "census_pop_2010s.csv",
        "years": list(range(2010, 2020)),
    },
    {
        "url": (
            "https://www2.census.gov/programs-surveys/popest/"
            "datasets/2000-2010/intercensal/state/"
            "st-est00int-alldata.csv"
        ),
        "dest": "census_pop_2000s.csv",
        "years": list(range(2000, 2010)),
    },
]

# Pre-2000 text/CSV files.
_1990S_ICEN_BASE = (
    "https://www2.census.gov/programs-surveys/popest/"
    "tables/1990-2000/intercensal/st-co"
)
_1980S_URL = (
    "https://www2.census.gov/programs-surveys/popest/"
    "tables/1980-1990/state/asrh/st8090ts.txt"
)
_1970S_URL = (
    "https://www2.census.gov/programs-surveys/popest/"
    "tables/1900-1980/state/asrh/pe-19.csv"
)


# =====================================================================
#  Public API
# =====================================================================

def fetch() -> pd.DataFrame:
    """Download Census population data, returning a tidy DataFrame.

    Columns: ``fips`` (str), ``year`` (int), ``value`` (float).
    """
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    frames: list[pd.DataFrame] = []

    # ── Modern CSV files (2000-2023) ────────────────────────────────
    for spec in _MODERN_FILES:
        df = _download_and_parse_modern(spec)
        if df is not None and not df.empty:
            frames.append(df)

    # ── 1990s fixed-width file ──────────────────────────────────────
    df = _fetch_1990s()
    if df is not None and not df.empty:
        frames.append(df)

    # ── 1980s abbreviation file ─────────────────────────────────────
    df = _fetch_1980s()
    if df is not None and not df.empty:
        frames.append(df)

    # ── 1970s age/race/sex CSV ──────────────────────────────────────
    df = _fetch_1970s()
    if df is not None and not df.empty:
        frames.append(df)

    if not frames:
        raise RuntimeError(
            "No Census population data could be fetched.  "
            "Check network connectivity to www2.census.gov."
        )

    combined = pd.concat(frames, ignore_index=True)
    combined = combined.drop_duplicates(subset=["fips", "year"], keep="first")
    combined = combined.sort_values(["fips", "year"]).reset_index(drop=True)

    logger.info(
        "Census population: %s rows, %d jurisdictions, years %d–%d",
        f"{len(combined):,}",
        combined["fips"].nunique(),
        int(combined["year"].min()),
        int(combined["year"].max()),
    )
    return combined


def load(conn: sqlite3.Connection, df: pd.DataFrame) -> int:
    """Insert population observations into the database.  Returns row count."""
    metric_id = _lookup_id(
        conn,
        "SELECT id FROM metrics WHERE slug = 'population'",
        "metric 'population'",
    )
    source_id = _lookup_id(
        conn,
        "SELECT id FROM sources WHERE name = 'Census Population Estimates'",
        "source 'Census Population Estimates'",
    )

    jur_rows = conn.execute(
        "SELECT id, code FROM jurisdictions WHERE type = 'state'"
    ).fetchall()
    fips_to_jid: dict[str, int] = {code: jid for jid, code in jur_rows}

    insert_rows: list[tuple[int, int, int, float, None, int]] = []
    skipped = 0
    for _, row in df.iterrows():
        jid = fips_to_jid.get(row["fips"])
        if jid is None:
            skipped += 1
            continue
        val = row["value"]
        if val is None or (isinstance(val, float) and math.isnan(val)):
            skipped += 1
            continue
        insert_rows.append((
            jid, metric_id, int(row["year"]), float(val), None, source_id,
        ))

    with conn:
        conn.executemany(
            "INSERT OR REPLACE INTO observations "
            "(jurisdiction_id, metric_id, year, value, sector, source_id) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            insert_rows,
        )

    if skipped:
        logger.info(
            "Skipped %d population rows (unknown FIPS or null)", skipped
        )
    logger.info("Loaded %s population observations", f"{len(insert_rows):,}")
    return len(insert_rows)


# =====================================================================
#  Modern CSV parser (2000-2023)
# =====================================================================

def _download_and_parse_modern(spec: dict[str, Any]) -> pd.DataFrame | None:
    """Download one Census CSV and extract POPESTIMATE columns."""
    url: str = spec["url"]
    dest = RAW_DIR / spec["dest"]
    years: list[int] = spec["years"]

    try:
        text = _download(url, dest)
    except Exception as exc:
        logger.warning("Could not download %s: %s", dest.name, exc)
        return None

    try:
        df = pd.read_csv(
            io.StringIO(text), encoding="latin-1", dtype={"STATE": str}
        )
    except Exception as exc:
        logger.warning("Could not parse %s: %s", dest.name, exc)
        return None

    # Filter to state-level rows
    if "SUMLEV" in df.columns:
        df = df[df["SUMLEV"].astype(str).str.strip() == "40"].copy()
    elif "AGEGRP" in df.columns:
        # Intercensal files use demographic breakdowns instead of SUMLEV.
        for col in ("SEX", "ORIGIN", "RACE", "AGEGRP"):
            if col in df.columns:
                df = df[df[col].astype(int) == 0].copy()
        df = df[df["STATE"].astype(str).str.strip() != "0"].copy()

    if "STATE" not in df.columns:
        logger.warning("No STATE column in %s", dest.name)
        return None

    df["fips"] = df["STATE"].astype(str).str.zfill(2)
    df = df[df["fips"].isin(_VALID_FIPS)]

    rows: list[dict[str, Any]] = []
    for year in years:
        col = f"POPESTIMATE{year}"
        if col not in df.columns:
            continue
        for _, r in df.iterrows():
            val = r[col]
            if pd.notna(val):
                rows.append({"fips": r["fips"], "year": year, "value": float(val)})

    if not rows:
        logger.warning("No data extracted from %s", dest.name)
        return None

    result = pd.DataFrame(rows)
    logger.info(
        "  %s → %d rows, years %d–%d",
        dest.name,
        len(result),
        int(result["year"].min()),
        int(result["year"].max()),
    )
    return result


# =====================================================================
#  1990s: intercensal county files summed to states
# =====================================================================

def _fetch_1990s() -> pd.DataFrame | None:
    """Sum the Census 1990-2000 *intercensal* county files to state totals.

    The older ``st-99-03.txt`` table holds the 1999 *postcensal* vintage, which
    was never revised after the 2000 census.  For fast-growing states that leaves a
    jump of up to ~12% between 1999 and 2000 (Nevada, DC, Arizona), and per-capita
    emissions in the 1990s come out too high.  The intercensal files
    (``stch-icen{year}.txt``: year, 5-digit county FIPS, age, sex, race/origin
    group, population) are the revised series EIA itself uses for its per-capita
    table, so summing them by state FIPS reproduces EIA's denominators exactly.
    """
    totals: dict[tuple[str, int], float] = {}
    for year in range(1990, 2000):
        dest = RAW_DIR / f"census_pop_{year}_icen.txt"
        url = f"{_1990S_ICEN_BASE}/stch-icen{year}.txt"
        try:
            text = _download(url, dest)
        except Exception as exc:
            logger.warning("Could not download 1990s intercensal %d: %s", year, exc)
            return None
        for line in text.splitlines():
            parts = line.split()
            if len(parts) < 6 or len(parts[1]) != 5:
                continue
            fips = parts[1][:2]
            if fips not in _VALID_FIPS:
                continue
            key = (fips, year)
            totals[key] = totals.get(key, 0.0) + float(parts[-1])

    if not totals:
        logger.warning("No data extracted from 1990s intercensal files")
        return None

    result = pd.DataFrame(
        [{"fips": f, "year": y, "value": v} for (f, y), v in totals.items()]
    )
    logger.info(
        "  1990s → %d rows, years %d–%d",
        len(result),
        int(result["year"].min()),
        int(result["year"].max()),
    )
    return result


# =====================================================================
#  1980s: st8090ts.txt — abbreviation rows, two blocks
# =====================================================================

def _fetch_1980s() -> pd.DataFrame | None:
    """Parse the Census st8090ts.txt file for 1980-1989 population."""
    dest = RAW_DIR / "census_pop_1980s.txt"
    try:
        text = _download(_1980S_URL, dest)
    except Exception as exc:
        logger.warning("Could not download 1980s population: %s", exc)
        return None

    rows: list[dict[str, Any]] = []
    lines = text.split("\n")

    # The file has two blocks:
    # Block 1: 4/80cen  7/81  7/82  7/83  7/84
    # Block 2: 7/85  7/86  7/87  7/88  7/89  4/90cen
    block_start = 0
    while block_start < len(lines):
        # Find header row containing year patterns like "4/80cen" or "7/81"
        header_line = lines[block_start]
        year_matches = list(re.finditer(
            r"(\d)/(\d{2})(cen)?", header_line
        ))
        if len(year_matches) < 3:
            block_start += 1
            continue

        # Map character positions to years
        year_cols: list[tuple[int, int]] = []
        for m in year_matches:
            yr_2digit = int(m.group(2))
            yr = 1900 + yr_2digit
            year_cols.append((m.start(), yr))

        # Parse data rows (state abbreviation followed by numbers)
        for i in range(block_start + 1, len(lines)):
            line = lines[i]
            if not line.strip():
                block_start = i + 1
                break

            # Format: "AL    3893888   3918531 ..."
            parts = line.split()
            if len(parts) < 2:
                continue

            abbr = parts[0].upper()
            fips = _ABBR_TO_FIPS.get(abbr)
            if fips is None:
                continue

            values = parts[1:]
            for idx, (_, yr) in enumerate(year_cols):
                if idx < len(values):
                    try:
                        val = float(values[idx])
                        rows.append({
                            "fips": fips, "year": yr, "value": val,
                        })
                    except ValueError:
                        continue
        else:
            block_start = len(lines)

    if not rows:
        logger.warning("No data extracted from 1980s population file")
        return None

    result = pd.DataFrame(rows)
    # Keep only 1980-1989 (drop census-date columns at boundaries)
    result = result[(result["year"] >= 1980) & (result["year"] <= 1989)]
    logger.info(
        "  1980s → %d rows, years %d–%d",
        len(result),
        int(result["year"].min()),
        int(result["year"].max()),
    )
    return result


# =====================================================================
#  1970s: pe-19.csv — age × race × sex CSV, summed to total
# =====================================================================

def _fetch_1970s() -> pd.DataFrame | None:
    """Parse pe-19.csv, summing all age/race/sex groups per state per year."""
    dest = RAW_DIR / "census_pop_1970s.csv"
    try:
        text = _download(_1970S_URL, dest)
    except Exception as exc:
        logger.warning("Could not download 1970s population: %s", exc)
        return None

    try:
        df = pd.read_csv(
            io.StringIO(text),
            skiprows=5,
            dtype=str,
            on_bad_lines="skip",
            encoding="latin-1",
        )
    except Exception as exc:
        logger.warning("Could not parse 1970s population CSV: %s", exc)
        return None

    # Columns: Year of Estimate, FIPS State Code, State Name,
    #          Race/Sex Indicator, Under 5 years, ..., 85 years and over
    yr_col = df.columns[0]   # "Year of Estimate"
    fips_col = df.columns[1]  # "FIPS State Code"
    # Age columns are columns 4 onward (index 4..end)
    age_cols = df.columns[4:]

    # Convert age columns to numeric (they have commas)
    for col in age_cols:
        df[col] = df[col].apply(_coerce_int)

    # Sum all age columns to get total persons per row
    df["total"] = df[age_cols].sum(axis=1)

    # Group by year and state FIPS, summing across race/sex groups
    df["fips"] = df[fips_col].astype(str).str.zfill(2)
    df["year"] = pd.to_numeric(df[yr_col], errors="coerce")
    df = df.dropna(subset=["year"])
    df["year"] = df["year"].astype(int)

    grouped = (
        df[df["fips"].isin(_VALID_FIPS)]
        .groupby(["fips", "year"])["total"]
        .sum()
        .reset_index()
    )
    grouped.columns = ["fips", "year", "value"]
    grouped["value"] = grouped["value"].astype(float)

    if grouped.empty:
        logger.warning("No data extracted from 1970s population CSV")
        return None

    logger.info(
        "  1970s → %d rows, years %d–%d",
        len(grouped),
        int(grouped["year"].min()),
        int(grouped["year"].max()),
    )
    return grouped


# =====================================================================
#  Helpers
# =====================================================================

def _download(url: str, dest: Path) -> str:
    """Download a file, save to *dest*, and return its text content."""
    with httpx.Client(follow_redirects=True, timeout=120) as client:
        r = client.get(url)
        r.raise_for_status()
    dest.write_bytes(r.content)
    logger.info("  Downloaded %s", dest.name)
    return r.content.decode("latin-1")


def _coerce_int(val: Any) -> float:
    """Convert a possibly comma-formatted string to a number, or 0."""
    if pd.isna(val):
        return 0.0
    s = str(val).strip().replace(",", "")
    if not s:
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


def _lookup_id(conn: sqlite3.Connection, sql: str, label: str) -> int:
    """Execute a single-column lookup and raise if missing."""
    row = conn.execute(sql).fetchone()
    if row is None:
        raise RuntimeError(f"{label} not found in database — run seed first")
    return row[0]
