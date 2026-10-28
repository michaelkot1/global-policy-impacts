"""Build data/app.db — the single entry point for the whole pipeline.

Steps:
  1. Fetch raw data (EIA CO2, Census population, BEA GDP).
  2. Clean, validate and load observations.
  3. Load policy YAML files.
  4. Run event-study estimates.
  5. Write everything to data/app.db.
"""

from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "app.db"


def main() -> None:
    print(f"Would build {DB_PATH}")
    raise NotImplementedError("Pipeline steps not yet implemented")


if __name__ == "__main__":
    main()
