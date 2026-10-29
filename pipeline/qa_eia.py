"""QA: compare data/app.db against EIA's *published* state CO2 tables.

The pipeline ingests EIA's API; the spreadsheets in ``data/raw/eia_co2_table*.xlsx``
are the tables EIA itself publishes at https://www.eia.gov/environment/emissions/state/.
This script reads those spreadsheets directly (it does not import the pipeline's own
parser) and checks, for the 51 jurisdictions:

1. Table 1: total CO2 for every state and year, 1970-2022, against ``observations``.
2. Table 3: 2022 values for each of the five sectors.
3. Table 2: 2022 values for each of the three fuels.
4. Sector and fuel parts add up to the total in every state-year.
5. Table 1 "Total of states" row against the sum of the database's states.
6. Table 4: EIA's per-capita values against emissions / population from the database
   (EIA uses its own population series, so this is a tolerance check, not equality).
7. Rankings (total and per capita; 1990, 2005 and 2022), recomputed from the
   spreadsheets and compared with the ranks the website computes from the database.

Run:  uv run python qa_eia.py          (from ``pipeline/``; exits non-zero on failure)
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
DB = ROOT / "data" / "app.db"

SECTORS = ["commercial", "electric_power", "residential", "industrial", "transportation"]
FUELS = ["coal", "petroleum", "natural_gas"]
ABS_TOL = 1e-6  # Mt CO2; the API and spreadsheets carry the same floats
# EIA's per-capita table divides by Census population. Since 1981 our population matches
# EIA's to <0.1%; in 1970-1980 EIA used a different (revised) Census vintage, so our
# values differ by up to ~2%. Both limits are checked.
PER_CAPITA_REL_TOL = 0.001
PER_CAPITA_REL_TOL_1970S = 0.025

failures: list[str] = []
notes: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


def sheet(n: int) -> list[tuple]:
    ws = openpyxl.load_workbook(RAW / f"eia_co2_table{n}.xlsx", data_only=True).worksheets[0]
    return list(ws.iter_rows(values_only=True))


def by_state(rows: list[tuple], header_row_idx: int) -> tuple[list, dict[str, tuple]]:
    header = list(rows[header_row_idx])
    out: dict[str, tuple] = {}
    for r in rows[header_row_idx + 1 :]:
        if r[0] and r[1] is not None and isinstance(r[1], (int, float)):
            out[str(r[0]).strip()] = r
    return header, out


def first_cols(header: list) -> dict[str, int]:
    out: dict[str, int] = {}
    for i, c in enumerate(header):
        if c:
            out.setdefault(str(c).strip().lower().replace(" ", "_"), i)
    return out


def main() -> int:
    con = sqlite3.connect(DB)
    state_name = dict(con.execute("SELECT id, name FROM jurisdictions WHERE type='state'"))
    co2 = con.execute("SELECT id FROM metrics WHERE slug='co2'").fetchone()[0]
    pop_id = con.execute("SELECT id FROM metrics WHERE slug='population'").fetchone()[0]

    db: dict[tuple[str, int, str], float | None] = {}
    for jid, year, sector, value in con.execute(
        "SELECT jurisdiction_id, year, sector, value FROM observations WHERE metric_id=?", (co2,)
    ):
        if jid in state_name:
            db[(state_name[jid], year, sector)] = value
    pop: dict[tuple[str, int], float] = {}
    for jid, year, value in con.execute(
        "SELECT jurisdiction_id, year, value FROM observations WHERE metric_id=?", (pop_id,)
    ):
        if jid in state_name and value is not None:
            pop[(state_name[jid], year)] = value
    names = sorted(state_name.values())

    # --- 1. Table 1: totals by year ------------------------------------------------
    rows1 = sheet(1)
    h1_idx = next(i for i, r in enumerate(rows1) if r[0] == "State")
    h1, t1 = by_state(rows1, h1_idx)
    years = [y for y in h1[1:] if isinstance(y, int)]
    n_checked = 0
    for name in names:
        if name not in t1:
            fail(f"Table 1 has no row for {name}")
            continue
        for j, y in enumerate(h1[1:], start=1):
            if not isinstance(y, int):
                continue
            pub = t1[name][j]
            got = db.get((name, y, "total"))
            n_checked += 1
            if pub is None or got is None or abs(pub - got) > ABS_TOL:
                fail(f"Table 1 total {name} {y}: EIA {pub} vs db {got}")
    print(f"[1] Table 1 totals: {n_checked} state-years compared "
          f"({len(names)} states x {len(years)} years)")

    # --- 2. Table 3: 2022 sectors --------------------------------------------------
    rows3 = sheet(3)
    h3_idx = next(i for i, r in enumerate(rows3) if r[0] == "State")
    h3, t3 = by_state(rows3, h3_idx)
    col3 = first_cols(h3)  # the first block of columns is Mt; later ones are shares
    n = 0
    for name in names:
        for s in SECTORS:
            pub = t3[name][col3[s]]
            got = db.get((name, 2022, s))
            n += 1
            if got is None or abs(pub - got) > ABS_TOL:
                fail(f"Table 3 {s} {name} 2022: EIA {pub} vs db {got}")
    print(f"[2] Table 3 sectors (2022): {n} values compared")

    # --- 3. Table 2: 2022 fuels ----------------------------------------------------
    rows2 = sheet(2)
    h2_idx = next(i for i, r in enumerate(rows2) if r[0] == "State")
    h2, t2 = by_state(rows2, h2_idx)
    col2 = first_cols(h2)
    n = 0
    for name in names:
        for f in FUELS:
            pub = t2[name][col2[f]]  # first occurrence = million metric tons
            got = db.get((name, 2022, f"fuel:{f}"))
            n += 1
            if got is None or abs(pub - got) > ABS_TOL:
                fail(f"Table 2 {f} {name} 2022: EIA {pub} vs db {got}")
    print(f"[3] Table 2 fuels (2022): {n} values compared")

    # --- 4. parts add up -----------------------------------------------------------
    bad_sec = bad_fuel = 0
    fuel_years = sorted({y for (_, y, s) in db if s.startswith("fuel:")})
    for name in names:
        for y in years:
            tot = db.get((name, y, "total"))
            parts = [db.get((name, y, s)) for s in SECTORS]
            if tot is not None and all(p is not None for p in parts):
                if abs(sum(parts) - tot) > 1e-6 * max(1.0, tot):
                    bad_sec += 1
                    fail(f"sectors != total {name} {y}: {sum(parts):.4f} vs {tot:.4f}")
            fparts = [db.get((name, y, f"fuel:{f}")) for f in FUELS]
            if tot is not None and all(p is not None for p in fparts):
                if abs(sum(fparts) - tot) > 1e-6 * max(1.0, tot):
                    bad_fuel += 1
                    fail(f"fuels != total {name} {y}: {sum(fparts):.4f} vs {tot:.4f}")
    print(f"[4] parts add up: sector mismatches={bad_sec}, fuel mismatches={bad_fuel} "
          f"(fuel data years {fuel_years[0]}-{fuel_years[-1]})")

    # --- 5. national total ---------------------------------------------------------
    total_row = next(r for r in rows1 if r[0] == "Total of states")
    worst = 0.0
    for j, y in enumerate(h1[1:], start=1):
        if not isinstance(y, int):
            continue
        s = sum(db[(nm, y, "total")] for nm in names)
        worst = max(worst, abs(s - total_row[j]) / total_row[j])
    print(f"[5] Sum of states vs Table 1 'Total of states' row: worst relative gap {worst:.2%}")
    # EIA's own state rows do not add exactly to its "Total of states" row before 2010
    # (gap up to ~0.2%, in EIA's file itself). The plan's rule is to fail above 1%.
    if worst > 0.01:
        fail(f"sum of states differs from EIA 'Total of states' by up to {worst:.2%}")

    # --- 6. per capita vs Table 4 --------------------------------------------------
    rows4 = sheet(4)
    h4_idx = next(i for i, r in enumerate(rows4) if r[0] == "State")
    h4, t4 = by_state(rows4, h4_idx)
    worst_rel, worst_where, over = 0.0, "", 0
    for name in names:
        for j, y in enumerate(h4[1:], start=1):
            if not isinstance(y, int):
                continue
            p = pop.get((name, y))
            if not p:
                continue
            mine = db[(name, y, "total")] * 1e6 / p
            rel = abs(mine - t4[name][j]) / t4[name][j]
            if rel > worst_rel:
                worst_rel, worst_where = rel, f"{name} {y}"
            if rel > (PER_CAPITA_REL_TOL_1970S if y <= 1980 else PER_CAPITA_REL_TOL):
                over += 1
    print(f"[6] Per capita vs Table 4: worst relative gap {worst_rel:.2%} ({worst_where}); "
          f"{over} state-years beyond tolerance "
          f"({PER_CAPITA_REL_TOL:.1%} from 1981, {PER_CAPITA_REL_TOL_1970S:.1%} for 1970-80)")
    if over:
        fail(f"{over} per-capita values differ from EIA Table 4 beyond tolerance")

    # --- 7. rankings ---------------------------------------------------------------
    def rank(values: dict[str, float]) -> dict[str, int]:
        order = sorted(values, key=lambda k: -values[k])
        return {k: i + 1 for i, k in enumerate(order)}

    for y in (1990, 2005, 2022):
        j = h1.index(y)
        pub_total = rank({nm: t1[nm][j] for nm in names})
        site_total = rank({nm: db[(nm, y, "total")] for nm in names})
        j4 = h4.index(y)
        pub_pc = rank({nm: t4[nm][j4] for nm in names})
        site_pc = rank({nm: db[(nm, y, "total")] * 1e6 / pop[(nm, y)] for nm in names})
        mism_t = [nm for nm in names if pub_total[nm] != site_total[nm]]
        mism_p = [nm for nm in names if pub_pc[nm] != site_pc[nm]]
        top5 = sorted(names, key=lambda k: pub_total[k])[:5]
        top5pc = sorted(names, key=lambda k: pub_pc[k])[:5]
        print(f"[7] {y}: total rank mismatches={len(mism_t)} {mism_t}; "
              f"per-capita rank mismatches={len(mism_p)} "
              f"{[(m, pub_pc[m], site_pc[m]) for m in mism_p]}")
        print(f"      top 5 total (EIA): {top5}")
        print(f"      top 5 per capita (EIA): {top5pc}")
        if mism_t:
            fail(f"{y}: total ranks differ for {mism_t}")
        # per-capita ranks may legitimately swap neighbours because of the population
        # series; only flag moves of more than 2 places.
        far = [m for m in mism_p if abs(pub_pc[m] - site_pc[m]) > 2]
        if far:
            fail(f"{y}: per-capita ranks move >2 places for {far}")

    print()
    if failures:
        print(f"FAILED ({len(failures)}):")
        for f in failures[:40]:
            print("  -", f)
        return 1
    print("OK: database matches EIA's published tables.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
