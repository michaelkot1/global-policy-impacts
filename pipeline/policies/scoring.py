"""Impact score: a -5..+5 summary of how large a policy's estimated effect is.

The score describes **size of effect only**. How much to trust the estimate is
carried separately by the evidence tier and the ``confidence`` field, and the
two are never merged into one number.

Definition (v1)
    * Input: the estimated percent change in the metric attributable to the
      policy (negative = the metric fell).
    * Sign: positive means the change moved the metric in its *desired*
      direction (``metrics.higher_is_better``), so a 20% fall in CO2 scores +5
      and a 20% rise scores -5. Percent changes are taken at face value, so the
      score applies to whatever population the estimate describes (see
      ``policy_effects.scope``); it is not rescaled to the whole economy.
    * Magnitude: |percent change| is binned::

          < 0.5%   -> 0
          0.5-2%   -> 1
          2-5%     -> 2
          5-10%    -> 3
          10-20%   -> 4
          >= 20%   -> 5
"""

from __future__ import annotations

# (upper bound of |percent change|, magnitude). The last bin is open-ended.
BINS: tuple[tuple[float, int], ...] = (
    (0.5, 0),
    (2.0, 1),
    (5.0, 2),
    (10.0, 3),
    (20.0, 4),
)
MAX_MAGNITUDE = 5


def impact_score(percent_change: float, higher_is_better: bool) -> float:
    """Return the -5..+5 impact score for an estimated percent change."""
    size = abs(percent_change)
    magnitude = MAX_MAGNITUDE
    for upper, value in BINS:
        if size < upper:
            magnitude = value
            break
    if magnitude == 0:
        return 0.0
    improved = percent_change > 0 if higher_is_better else percent_change < 0
    return float(magnitude if improved else -magnitude)
