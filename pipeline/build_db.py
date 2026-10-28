"""Build data/app.db — the single entry point for the whole pipeline.

Steps:
  1. Create the schema and seed reference rows.
  2. Fetch raw data (EIA CO2, Census population, BEA GDP).
  3. Clean, validate and load observations.
  4. Load policy YAML files.
  5. Run event-study estimates.
  6. Write everything to data/app.db.
"""

import logging
import sqlite3
from pathlib import Path

import schema
import seed
from sources import eia_co2

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "app.db"

logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


def init_db() -> sqlite3.Connection:
    """Create (or recreate) the database with schema and seed data."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    DB_PATH.unlink(missing_ok=True)

    conn = sqlite3.connect(str(DB_PATH))
    schema.create_tables(conn)
    seed.seed_all(conn)
    return conn


def main() -> None:
    conn = init_db()

    # ── Ingest EIA CO₂ data ────────────────────────────────────────────
    co2 = eia_co2.fetch()
    eia_co2.validate(co2)
    n_obs = eia_co2.load(conn, co2)

    # ── Summary ────────────────────────────────────────────────────────
    n_jur = conn.execute("SELECT count(*) FROM jurisdictions").fetchone()[0]
    n_src = conn.execute("SELECT count(*) FROM sources").fetchone()[0]
    n_met = conn.execute("SELECT count(*) FROM metrics").fetchone()[0]
    n_obs = conn.execute("SELECT count(*) FROM observations").fetchone()[0]
    print(f"✓ Built {DB_PATH}")
    print(f"  {n_jur} jurisdictions, {n_src} sources, {n_met} metrics seeded")
    print(f"  {n_obs:,} CO₂ observations loaded")

    conn.close()


if __name__ == "__main__":
    main()
