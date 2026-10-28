"""Fetch state-level energy-related CO₂ emissions from the EIA API v2.

Primary path
    EIA API v2 endpoint ``co2-emissions/co2-emissions-aggregates``, using the
    ``EIA_API_KEY`` environment variable (set in ``.env``).

Fallback
    Downloadable Excel spreadsheets from the EIA website when the API key
    is missing or the API is unreachable.

The public interface has three functions that ``build_db`` calls in order::

    df = fetch()         # returns a normalised DataFrame
    validate(df)         # raises on >1 % state-vs-US discrepancy
    load(conn, df)       # inserts into the observations table
"""

from __future__ import annotations

import json
import logging
import math
import os
import re
import sqlite3
import time
from pathlib import Path
from typing import Any

import httpx
import pandas as pd
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

# ── Paths ───────────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent.parent          # repo root
RAW_DIR = ROOT / "data" / "raw"
ENV_FILE = ROOT / ".env"

# ── EIA API v2 ──────────────────────────────────────────────────────────
_API_BASE = "https://api.eia.gov/v2"
_CO2_ROUTE = "co2-emissions/co2-emissions-aggregates"
_PAGE_SIZE = 5000                                             # API max

# ── EIA spreadsheet fallback ────────────────────────────────────────────
_XLS_BASE = "https://www.eia.gov/environment/emissions/state/excel"

# ── Facet code → label ──────────────────────────────────────────────────
_SECTOR_MAP: dict[str, str] = {
    "TT": "total",
    "CC": "commercial",
    "II": "industrial",
    "RC": "residential",
    "TC": "transportation",
    "EC": "electric_power",
}

_FUEL_MAP: dict[str, str] = {
    "TO": "total",
    "CO": "coal",
    "NG": "natural_gas",
    "PE": "petroleum",
}

# ── EIA abbreviation → FIPS code (for DB join) ─────────────────────────
ABBR_TO_FIPS: dict[str, str] = {
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

# ── State name → abbreviation (spreadsheet fallback) ───────────────────
_NAME_TO_ABBR: dict[str, str] = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR",
    "california": "CA", "colorado": "CO", "connecticut": "CT",
    "delaware": "DE", "district of columbia": "DC", "florida": "FL",
    "georgia": "GA", "hawaii": "HI", "idaho": "ID", "illinois": "IL",
    "indiana": "IN", "iowa": "IA", "kansas": "KS", "kentucky": "KY",
    "louisiana": "LA", "maine": "ME", "maryland": "MD",
    "massachusetts": "MA", "michigan": "MI", "minnesota": "MN",
    "mississippi": "MS", "missouri": "MO", "montana": "MT",
    "nebraska": "NE", "nevada": "NV", "new hampshire": "NH",
    "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
    "north carolina": "NC", "north dakota": "ND", "ohio": "OH",
    "oklahoma": "OK", "oregon": "OR", "pennsylvania": "PA",
    "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
    "tennessee": "TN", "texas": "TX", "utah": "UT", "vermont": "VT",
    "virginia": "VA", "washington": "WA", "west virginia": "WV",
    "wisconsin": "WI", "wyoming": "WY",
    # National-level aliases found in EIA spreadsheets
    "united states": "US", "u.s. total": "US", "us total": "US",
    "u.s.": "US", "total of states": "US", "total": "US",
}


# =====================================================================
#  Public API
# =====================================================================

def fetch() -> pd.DataFrame:
    """Fetch EIA state CO₂ data, trying the API first, then spreadsheets.

    Returns a DataFrame with columns:

    * ``state_id`` — EIA 2-letter abbreviation (or ``"US"``)
    * ``year``     — calendar year (int)
    * ``sector``   — ``"total"``, a sector name, or ``"fuel:<name>"``
    * ``value``    — million metric tons CO₂ (float or NaN)
    """
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    api_key = _get_api_key()
    if api_key:
        try:
            df = _fetch_via_api(api_key)
            if not df.empty:
                return df
            logger.warning("API returned no usable data; trying spreadsheet")
        except Exception as exc:
            logger.warning("EIA API failed (%s); trying spreadsheet", exc)
    else:
        logger.info("No EIA_API_KEY in .env — using spreadsheet fallback")

    return _fetch_via_spreadsheet()


def validate(df: pd.DataFrame) -> None:
    """Assert that the sum-of-states total matches the US total within 1 %.

    Compares only the ``sector == "total"`` rows.  Raises ``ValueError``
    if any year exceeds the tolerance.
    """
    totals = df.loc[df["sector"] == "total"].copy()

    us = (
        totals.loc[totals["state_id"] == "US"]
        .dropna(subset=["value"])
        .set_index("year")["value"]
    )
    states_sum = (
        totals.loc[totals["state_id"] != "US"]
        .dropna(subset=["value"])
        .groupby("year")["value"]
        .sum()
    )

    years = sorted(set(us.index) & set(states_sum.index))
    if not years:
        raise ValueError("No overlapping years between state and US data")

    failures: list[str] = []
    for yr in years:
        us_val = us.loc[yr]
        st_val = states_sum.loc[yr]
        if us_val == 0:
            continue
        pct = abs(st_val - us_val) / abs(us_val)
        if pct > 0.01:
            failures.append(
                f"  {yr}: states={st_val:.2f}, US={us_val:.2f}, diff={pct:.2%}"
            )

    if failures:
        raise ValueError(
            f"State CO₂ totals differ from US total by >1 % in "
            f"{len(failures)} year(s):\n" + "\n".join(failures)
        )

    logger.info(
        "✓ Validation passed — state sums match US total (±1 %%) "
        "for all %d years (%d–%d)",
        len(years), min(years), max(years),
    )


def load(conn: sqlite3.Connection, df: pd.DataFrame) -> int:
    """Insert CO₂ observations into the database.  Returns the row count."""
    metric_id = _lookup_id(
        conn, "SELECT id FROM metrics WHERE slug = 'co2'", "metric 'co2'"
    )
    source_id = _lookup_id(
        conn,
        "SELECT id FROM sources WHERE name = 'EIA State CO2 Emissions'",
        "source 'EIA State CO2 Emissions'",
    )

    # Build abbreviation → jurisdiction-id mapping
    jur_rows = conn.execute(
        "SELECT id, code, type FROM jurisdictions"
    ).fetchall()
    fips_to_jid = {code: jid for jid, code, jtype in jur_rows if jtype == "state"}
    us_jid = next(
        (jid for jid, code, jtype in jur_rows
         if jtype == "country" and code == "US"),
        None,
    )

    abbr_to_jid: dict[str, int] = {}
    for abbr, fips in ABBR_TO_FIPS.items():
        jid = fips_to_jid.get(fips)
        if jid is not None:
            abbr_to_jid[abbr] = jid
    if us_jid is not None:
        abbr_to_jid["US"] = us_jid

    # Collect rows to insert, skipping unknowns and nulls
    insert_rows: list[tuple[int, int, int, float, str, int]] = []
    skipped = 0
    for _, row in df.iterrows():
        jid = abbr_to_jid.get(row["state_id"])
        if jid is None:
            skipped += 1
            continue
        val = row["value"]
        if val is None or (isinstance(val, float) and math.isnan(val)):
            skipped += 1
            continue
        insert_rows.append((
            jid, metric_id, int(row["year"]), float(val),
            row["sector"], source_id,
        ))

    with conn:
        conn.executemany(
            "INSERT OR REPLACE INTO observations "
            "(jurisdiction_id, metric_id, year, value, sector, source_id) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            insert_rows,
        )

    if skipped:
        logger.info("Skipped %d rows (unknown jurisdiction or null value)", skipped)
    logger.info("Loaded %s CO₂ observations", f"{len(insert_rows):,}")
    return len(insert_rows)


# =====================================================================
#  EIA API v2
# =====================================================================

def _get_api_key() -> str | None:
    """Read ``EIA_API_KEY`` from ``.env``, returning *None* if absent."""
    load_dotenv(ENV_FILE)
    key = os.getenv("EIA_API_KEY", "").strip()
    return key or None


def _fetch_via_api(api_key: str) -> pd.DataFrame:
    """Paginate through the full CO₂ dataset and return a normalised frame."""
    logger.info("Fetching CO₂ data from EIA API v2 …")

    records: list[dict[str, Any]] = []
    offset = 0
    total: int | None = None

    with httpx.Client() as client:
        while True:
            body = _api_page(client, api_key, offset)
            resp = body.get("response", {})

            if total is None:
                total = resp.get("total", 0)
                logger.info("  API reports %s total records", f"{total:,}")

            page = resp.get("data", [])
            if not page:
                break

            records.extend(page)
            offset += len(page)
            logger.info("  fetched %s / %s", f"{offset:,}", f"{total:,}")

            if offset >= total:
                break
            time.sleep(0.25)

    # Persist raw download for reproducibility
    raw_path = RAW_DIR / "eia_co2_api.json"
    raw_path.write_text(json.dumps(records))
    logger.info("Saved %s raw records → %s", f"{len(records):,}", raw_path)

    return _normalise_api(records)


def _api_page(
    client: httpx.Client, api_key: str, offset: int
) -> dict[str, Any]:
    """Fetch one page of results from the EIA API."""
    r = client.get(
        f"{_API_BASE}/{_CO2_ROUTE}/data/",
        params={
            "api_key": api_key,
            "frequency": "annual",
            "data[0]": "value",
            "offset": offset,
            "length": _PAGE_SIZE,
            "sort[0][column]": "period",
            "sort[0][direction]": "asc",
        },
        timeout=60,
    )
    r.raise_for_status()
    return r.json()


def _normalise_api(records: list[dict]) -> pd.DataFrame:
    """Convert raw API records into the standard 4-column DataFrame."""
    rows: list[dict[str, Any]] = []
    for rec in records:
        sid = rec.get("stateId", "")
        sec = rec.get("sectorId", "")
        fuel = rec.get("fuelId", "")
        period = rec.get("period")
        raw_val = rec.get("value")

        label = _sector_label(sec, fuel)
        if label is None or not sid or period is None:
            continue

        rows.append({
            "state_id": sid,
            "year": int(period),
            "sector": label,
            "value": _coerce_value(raw_val),
        })

    df = pd.DataFrame(rows)
    if df.empty:
        return df

    logger.info(
        "Normalised %s rows — %d regions, years %d–%d",
        f"{len(df):,}",
        df["state_id"].nunique(),
        int(df["year"].min()),
        int(df["year"].max()),
    )
    return df


# =====================================================================
#  Spreadsheet fallback
# =====================================================================

# Column header → our sector label for cross-sectional tables
_COL_TO_SECTOR: dict[str, str] = {
    "commercial": "commercial",
    "electric power": "electric_power",
    "residential": "residential",
    "industrial": "industrial",
    "transportation": "transportation",
    "coal": "fuel:coal",
    "petroleum": "fuel:petroleum",
    "natural gas": "fuel:natural_gas",
}


def _fetch_via_spreadsheet() -> pd.DataFrame:
    """Download and parse EIA state CO₂ Excel workbooks.

    * **Table 1** — total CO₂ by state, full time-series (1970–present).
    * **Table 2** — CO₂ by fuel, latest year only.
    * **Table 3** — CO₂ by sector, latest year only.
    * Tables 4–6 contain different metrics (per-capita, energy intensity,
      carbon intensity) and are intentionally skipped.
    """
    logger.info("Downloading EIA CO₂ spreadsheets …")

    frames: list[pd.DataFrame] = []

    # Table 1: total CO₂ time-series — required for validation
    total_path = _download_xls("table1", required=True)
    frames.append(_parse_timeseries_xls(total_path))

    # Table 2: CO₂ by fuel (single-year cross-section)
    fuel_path = _download_xls("table2", required=False)
    if fuel_path is not None:
        frames.append(_parse_crosssection_xls(fuel_path))

    # Table 3: CO₂ by sector (single-year cross-section)
    sector_path = _download_xls("table3", required=False)
    if sector_path is not None:
        frames.append(_parse_crosssection_xls(sector_path))

    df = pd.concat(frames, ignore_index=True)
    logger.info(
        "Spreadsheet fallback: %s rows, years %d–%d",
        f"{len(df):,}",
        int(df["year"].min()),
        int(df["year"].max()),
    )
    return df


def _download_xls(table_name: str, *, required: bool) -> Path | None:
    """Download one EIA Excel file, returning its local path."""
    url = f"{_XLS_BASE}/{table_name}.xlsx"
    dest = RAW_DIR / f"eia_co2_{table_name}.xlsx"
    try:
        with httpx.Client(follow_redirects=True) as client:
            r = client.get(url, timeout=120)
            r.raise_for_status()
        dest.write_bytes(r.content)
        logger.info("  downloaded %s → %s", url, dest.name)
        return dest
    except httpx.HTTPError as exc:
        if required:
            raise RuntimeError(
                f"Cannot download required spreadsheet {url}: {exc}. "
                "Set EIA_API_KEY in .env to use the API instead."
            ) from exc
        logger.info("  optional %s not available: %s", table_name, exc)
        return None


# ── Time-series parser (Table 1: states × years) ───────────────────────

def _parse_timeseries_xls(path: Path) -> pd.DataFrame:
    """Parse Table 1 (states as rows, years as columns) → sector='total'."""
    xls = pd.ExcelFile(path, engine="openpyxl")
    all_rows: list[dict[str, Any]] = []

    for sheet in xls.sheet_names:
        raw = pd.read_excel(xls, sheet_name=sheet, header=None)
        all_rows.extend(_parse_timeseries_sheet(raw))

    if all_rows:
        return pd.DataFrame(all_rows)
    return pd.DataFrame(columns=["state_id", "year", "sector", "value"])


def _parse_timeseries_sheet(raw: pd.DataFrame) -> list[dict[str, Any]]:
    """Parse one sheet in states × years layout."""
    header_idx: int | None = None
    year_cols: dict[int, int] = {}

    for i in range(min(25, len(raw))):
        found: dict[int, int] = {}
        for j in range(1, raw.shape[1]):
            try:
                yr = int(float(raw.iat[i, j]))
            except (ValueError, TypeError):
                continue
            if 1960 <= yr <= 2035:
                found[j] = yr
        if len(found) >= 5:
            header_idx = i
            year_cols = found
            break

    if header_idx is None:
        return []

    rows: list[dict[str, Any]] = []
    for i in range(header_idx + 1, len(raw)):
        cell = str(raw.iat[i, 0]).strip()
        abbr = _NAME_TO_ABBR.get(cell.lower())
        if abbr is None:
            continue
        for col_idx, yr in year_cols.items():
            rows.append({
                "state_id": abbr,
                "year": yr,
                "sector": "total",
                "value": _coerce_value(raw.iat[i, col_idx]),
            })
    return rows


# ── Cross-section parser (Tables 2-3: states × categories, one year) ──

def _parse_crosssection_xls(path: Path) -> pd.DataFrame:
    """Parse Tables 2/3 (states × sector-or-fuel columns, single year)."""
    xls = pd.ExcelFile(path, engine="openpyxl")
    all_rows: list[dict[str, Any]] = []

    for sheet in xls.sheet_names:
        raw = pd.read_excel(xls, sheet_name=sheet, header=None)
        all_rows.extend(_parse_crosssection_sheet(raw))

    if all_rows:
        return pd.DataFrame(all_rows)
    return pd.DataFrame(columns=["state_id", "year", "sector", "value"])


def _parse_crosssection_sheet(raw: pd.DataFrame) -> list[dict[str, Any]]:
    """Parse a sheet with states as rows and category columns for one year.

    Extracts the year from the title row (e.g. "2022 state energy-related…").
    Only reads columns whose headers map to a known sector/fuel label and
    stops at the first "shares" group (if present).
    """
    # Extract the year from the title in the first few rows
    year: int | None = None
    for i in range(min(5, len(raw))):
        cell = str(raw.iat[i, 0])
        m = re.search(r"\b(19[7-9]\d|20[0-3]\d)\b", cell)
        if m:
            year = int(m.group(1))
            break
    if year is None:
        return []

    # Find the header row (first row starting with "State")
    header_idx: int | None = None
    for i in range(min(10, len(raw))):
        if str(raw.iat[i, 0]).strip().lower() == "state":
            header_idx = i
            break
    if header_idx is None:
        return []

    # Map category columns — stop before the "shares" group
    cat_cols: list[tuple[int, str]] = []
    for j in range(1, raw.shape[1]):
        hdr = str(raw.iat[header_idx, j]).strip().lower()
        # Check the row above for "shares" label to detect the second group
        if header_idx >= 1:
            above = str(raw.iat[header_idx - 1, j]).strip().lower()
            if "share" in above:
                break
        label = _COL_TO_SECTOR.get(hdr)
        if label is not None:
            cat_cols.append((j, label))

    if not cat_cols:
        return []

    rows: list[dict[str, Any]] = []
    for i in range(header_idx + 1, len(raw)):
        cell = str(raw.iat[i, 0]).strip()
        abbr = _NAME_TO_ABBR.get(cell.lower())
        if abbr is None:
            continue
        for col_idx, sector_label in cat_cols:
            rows.append({
                "state_id": abbr,
                "year": year,
                "sector": sector_label,
                "value": _coerce_value(raw.iat[i, col_idx]),
            })
    return rows


# =====================================================================
#  Helpers
# =====================================================================

def _sector_label(sector_code: str, fuel_code: str) -> str | None:
    """Map an EIA ``(sectorId, fuelId)`` pair to our ``sector`` column value.

    Returns *None* for sector × fuel cross-tabulations we don't store in v1.
    The rows we keep are:

    * Sector totals (any sector, fuel = TO) → ``"total"`` / ``"residential"`` / …
    * Fuel totals   (sector = TT, any fuel) → ``"fuel:coal"`` / …
    """
    sector = _SECTOR_MAP.get(sector_code)
    fuel = _FUEL_MAP.get(fuel_code)
    if sector is None or fuel is None:
        return None
    if fuel == "total":
        return sector          # "total", "residential", …
    if sector == "total":
        return f"fuel:{fuel}"  # "fuel:coal", …
    return None                # skip sector × fuel cross-tab


def _coerce_value(raw: Any) -> float | None:
    """Coerce an API or Excel cell to ``float``, or ``None`` if missing."""
    if raw is None:
        return None
    if isinstance(raw, str):
        s = raw.strip()
        if not s or s.upper() in ("W", "NA", "N/A", "--", ".", "X", "NM"):
            return None
        try:
            return float(s.replace(",", ""))
        except ValueError:
            return None
    try:
        v = float(raw)
        return None if math.isnan(v) else v
    except (ValueError, TypeError):
        return None


def _lookup_id(conn: sqlite3.Connection, sql: str, label: str) -> int:
    """Execute a single-column lookup and raise if not found."""
    row = conn.execute(sql).fetchone()
    if row is None:
        raise RuntimeError(f"{label} not found in database — run seed first")
    return row[0]
