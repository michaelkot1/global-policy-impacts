"""Fetch state-level energy-related CO2 emissions from the EIA API v2.

Uses the ``co2-emissions/co2-emissions-aggregates`` endpoint.  Falls back
to the downloadable spreadsheets when the API is unavailable.
"""


def fetch() -> None:
    """Download CO2 emissions data into data/raw/."""
    raise NotImplementedError
