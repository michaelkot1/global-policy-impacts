"""Fetch state GDP from the Bureau of Economic Analysis.

Primary path
    BEA API v2 using the ``BEA_API_KEY`` environment variable (set in
    ``.env``).  Queries the **Regional** dataset, table **SAGDP1** (GDP in
    current dollars, all-industry total, line code 1), for every state and
    all available years (1997 onward).

Fallback
    Direct CSV download of the SAGDP1 table from the BEA bulk-data site.

The public interface has two functions that ``build_db`` calls::

    df = fetch()         # returns a normalised DataFrame
    load(conn, df)       # inserts into the observations table
"""

from __future__ import annotations

import io
import logging
import math
import os
import re
import sqlite3
from pathlib import Path
from typing import Any

import httpx
import pandas as pd
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent.parent.parent
RAW_DIR = ROOT / "data" / "raw"
ENV_FILE = ROOT / ".env"

_API_BASE = "https://apps.bea.gov/api/data/"

# FIPS codes for the 50 states + DC
_VALID_FIPS: set[str] = {
    "01", "02", "04", "05", "06", "08", "09", "10", "11", "12",
    "13", "15", "16", "17", "18", "19", "20", "21", "22", "23",
    "24", "25", "26", "27", "28", "29", "30", "31", "32", "33",
    "34", "35", "36", "37", "38", "39", "40", "41", "42", "44",
    "45", "46", "47", "48", "49", "50", "51", "53", "54", "55", "56",
}

# BEA GeoFips → 2-digit FIPS: BEA uses 5-digit codes like "01000"
_BEA_STATE_NAME_TO_FIPS: dict[str, str] = {
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

# Fallback CSV URLs for bulk SAGDP downloads (BEA updates these periodically)
_FALLBACK_URLS: list[str] = [
    "https://apps.bea.gov/regional/zip/SAGDP1.zip",
    (
        "https://apps.bea.gov/regional/zip/"
        "SAGDP1__ALL_AREAS_1997_2023.csv"
    ),
]


# =====================================================================
#  Public API
# =====================================================================

def fetch() -> pd.DataFrame:
    """Fetch BEA state GDP data, trying the API first, then CSV download.

    Returns a DataFrame with columns:

    * ``fips``  — 2-digit FIPS code (str)
    * ``year``  — calendar year (int)
    * ``value`` — GDP in millions of current US dollars (float)
    """
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    api_key = _get_api_key()
    if api_key:
        try:
            df = _fetch_via_api(api_key)
            if not df.empty:
                return df
            logger.warning("BEA API returned no data; trying CSV fallback")
        except Exception as exc:
            logger.warning("BEA API failed (%s); trying CSV fallback", exc)
    else:
        logger.info("No BEA_API_KEY in .env — using CSV fallback")

    return _fetch_via_csv()


def load(conn: sqlite3.Connection, df: pd.DataFrame) -> int:
    """Insert GDP observations into the database.  Returns row count."""
    metric_id = _lookup_id(
        conn,
        "SELECT id FROM metrics WHERE slug = 'gdp'",
        "metric 'gdp'",
    )
    source_id = _lookup_id(
        conn,
        "SELECT id FROM sources WHERE name = 'BEA State GDP'",
        "source 'BEA State GDP'",
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
        logger.info("Skipped %d GDP rows (unknown FIPS or null)", skipped)
    logger.info("Loaded %s GDP observations", f"{len(insert_rows):,}")
    return len(insert_rows)


# =====================================================================
#  BEA API v2
# =====================================================================

def _get_api_key() -> str | None:
    """Read ``BEA_API_KEY`` from ``.env``, returning *None* if absent."""
    load_dotenv(ENV_FILE)
    key = os.getenv("BEA_API_KEY", "").strip()
    return key or None


def _fetch_via_api(api_key: str) -> pd.DataFrame:
    """Query the BEA Regional API for SAGDP1 (all-industry GDP)."""
    logger.info("Fetching state GDP from BEA API …")

    with httpx.Client(timeout=120) as client:
        r = client.get(
            _API_BASE,
            params={
                "UserID": api_key,
                "method": "GetData",
                "datasetname": "Regional",
                "TableName": "SAGDP1",
                "LineCode": "1",
                "GeoFips": "STATE",
                "Year": "ALL",
                "ResultFormat": "JSON",
            },
        )
        r.raise_for_status()
        body = r.json()

    raw_path = RAW_DIR / "bea_gdp_api.json"
    raw_path.write_text(r.text)
    logger.info("  Saved raw API response → %s", raw_path.name)

    return _normalise_api(body)


def _normalise_api(body: dict[str, Any]) -> pd.DataFrame:
    """Convert the BEA API JSON response into a tidy DataFrame."""
    try:
        data = body["BEAAPI"]["Results"]["Data"]
    except (KeyError, TypeError):
        logger.warning("Unexpected BEA API response structure")
        return pd.DataFrame()

    rows: list[dict[str, Any]] = []
    for rec in data:
        geo = rec.get("GeoFips", "")
        fips = _bea_geo_to_fips(geo, rec.get("GeoName", ""))
        if fips is None:
            continue

        try:
            year = int(rec["TimePeriod"])
        except (KeyError, ValueError, TypeError):
            continue

        val = _coerce_value(rec.get("DataValue"))
        if val is None:
            continue

        rows.append({"fips": fips, "year": year, "value": val})

    df = pd.DataFrame(rows)
    if df.empty:
        return df

    logger.info(
        "  BEA API: %s rows, %d states, years %d–%d",
        f"{len(df):,}",
        df["fips"].nunique(),
        int(df["year"].min()),
        int(df["year"].max()),
    )
    return df


# =====================================================================
#  CSV fallback
# =====================================================================

def _fetch_via_csv() -> pd.DataFrame:
    """Download and parse a SAGDP1 CSV from the BEA website."""
    logger.info("Downloading state GDP CSV from BEA …")

    for url in _FALLBACK_URLS:
        try:
            dest = RAW_DIR / "bea_gdp_sagdp1.csv"
            if url.endswith(".zip"):
                df = _download_and_parse_zip(url, dest)
            else:
                df = _download_and_parse_flat(url, dest)
            if df is not None and not df.empty:
                return df
        except Exception as exc:
            logger.info("  CSV fallback %s failed: %s", url, exc)

    raise RuntimeError(
        "Could not fetch BEA GDP data.  Set BEA_API_KEY in .env "
        "(register free at https://apps.bea.gov/api/signup/) or check "
        "network access to apps.bea.gov."
    )


def _download_and_parse_zip(url: str, dest: Path) -> pd.DataFrame | None:
    """Download a ZIP, extract the first CSV inside, and parse it."""
    import zipfile

    with httpx.Client(follow_redirects=True, timeout=180) as client:
        r = client.get(url)
        r.raise_for_status()

    zip_path = RAW_DIR / "bea_gdp_sagdp1.zip"
    zip_path.write_bytes(r.content)

    with zipfile.ZipFile(zip_path) as zf:
        csv_names = [n for n in zf.namelist() if n.lower().endswith(".csv")]
        if not csv_names:
            return None
        with zf.open(csv_names[0]) as f:
            text = f.read().decode("latin-1")

    dest.write_text(text, encoding="utf-8")
    logger.info("  Extracted %s from ZIP", csv_names[0])
    return _parse_sagdp_csv(text)


def _download_and_parse_flat(url: str, dest: Path) -> pd.DataFrame | None:
    """Download a flat CSV and parse it."""
    with httpx.Client(follow_redirects=True, timeout=180) as client:
        r = client.get(url)
        r.raise_for_status()

    dest.write_bytes(r.content)
    logger.info("  Downloaded %s", dest.name)
    return _parse_sagdp_csv(r.content.decode("latin-1"))


def _parse_sagdp_csv(text: str) -> pd.DataFrame | None:
    """Parse a BEA SAGDP1 CSV (wide format: one column per year).

    The CSV typically has columns like:
      GeoFIPS, GeoName, Region, TableName, LineCode, IndustryClassification,
      Description, Unit, 1997, 1998, …, 2023

    We filter to LineCode == 1 (All industry total) and extract year columns.
    """
    try:
        df = pd.read_csv(io.StringIO(text), dtype=str, encoding="latin-1")
    except Exception as exc:
        logger.warning("Could not parse SAGDP CSV: %s", exc)
        return None

    # Normalise column names (BEA sometimes has trailing spaces)
    df.columns = [c.strip().strip('"') for c in df.columns]

    # Identify the GeoFIPS or GeoFips column
    geo_col = _find_col(df, ["GeoFIPS", "GeoFips", "GEOFIPS"])
    name_col = _find_col(df, ["GeoName", "GEONAME"])
    line_col = _find_col(df, ["LineCode", "LINECODE"])

    if geo_col is None and name_col is None:
        logger.warning("No geo column found in SAGDP CSV")
        return None

    # Filter to LineCode 1 if the column exists
    if line_col is not None:
        df = df[df[line_col].astype(str).str.strip() == "1"].copy()

    # Find year columns (4-digit integers ≥ 1997)
    year_cols: list[tuple[str, int]] = []
    for col in df.columns:
        col_clean = col.strip().strip('"')
        if re.fullmatch(r"\d{4}", col_clean):
            yr = int(col_clean)
            if 1970 <= yr <= 2040:
                year_cols.append((col, yr))

    if not year_cols:
        logger.warning("No year columns found in SAGDP CSV")
        return None

    rows: list[dict[str, Any]] = []
    for _, r in df.iterrows():
        if geo_col is not None:
            fips = _bea_geo_to_fips(
                str(r[geo_col]).strip().strip('"'),
                str(r[name_col]).strip().strip('"') if name_col else "",
            )
        else:
            fips = _name_to_fips(str(r[name_col]).strip().strip('"'))
        if fips is None:
            continue

        for col_name, yr in year_cols:
            val = _coerce_value(r[col_name])
            if val is not None:
                rows.append({"fips": fips, "year": yr, "value": val})

    if not rows:
        return None

    result = pd.DataFrame(rows)
    logger.info(
        "  SAGDP CSV: %s rows, %d states, years %d–%d",
        f"{len(result):,}",
        result["fips"].nunique(),
        int(result["year"].min()),
        int(result["year"].max()),
    )
    return result


# =====================================================================
#  Helpers
# =====================================================================

def _bea_geo_to_fips(geo_fips: str, geo_name: str = "") -> str | None:
    """Convert a BEA 5-digit GeoFips (e.g. ``'01000'``) to a 2-digit FIPS.

    Falls back to name lookup if the code doesn't match a state.
    """
    clean = geo_fips.strip().strip('"')
    if len(clean) == 5 and clean.endswith("000"):
        fips2 = clean[:2]
        if fips2 in _VALID_FIPS:
            return fips2
    return _name_to_fips(geo_name)


def _name_to_fips(name: str) -> str | None:
    """Look up a state name to its FIPS code."""
    key = name.strip().strip('"').lower()
    # Handle BEA suffixes like "Alabama *" or "District of Columbia"
    key = re.sub(r"\s*\*+$", "", key)
    return _BEA_STATE_NAME_TO_FIPS.get(key)


def _find_col(df: pd.DataFrame, candidates: list[str]) -> str | None:
    """Return the first column name from *candidates* present in *df*."""
    cols_lower = {c.lower().strip(): c for c in df.columns}
    for c in candidates:
        actual = cols_lower.get(c.lower().strip())
        if actual is not None:
            return actual
    return None


def _coerce_value(raw: Any) -> float | None:
    """Coerce a BEA value (often a comma-formatted string) to float."""
    if raw is None:
        return None
    s = str(raw).strip().strip('"')
    if not s or s in ("(NA)", "(D)", "(L)", "(T)", "...", "--", "N/A"):
        return None
    try:
        return float(s.replace(",", ""))
    except ValueError:
        return None


def _lookup_id(conn: sqlite3.Connection, sql: str, label: str) -> int:
    """Execute a single-column lookup and raise if missing."""
    row = conn.execute(sql).fetchone()
    if row is None:
        raise RuntimeError(f"{label} not found in database — run seed first")
    return row[0]
