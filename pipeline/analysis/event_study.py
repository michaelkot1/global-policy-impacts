"""Staggered difference-in-differences / event-study estimator.

Estimates the effect of state policies (RPS, RGGI membership, etc.)
on CO2 per capita and electric-power-sector CO2, using state and year
fixed effects, controlling for population and GDP.
"""


def run_event_study() -> None:
    """Run the event study and write tier-B estimates to the database."""
    raise NotImplementedError
