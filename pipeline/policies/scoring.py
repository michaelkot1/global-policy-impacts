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

Every policy-metric link has a score. ``score_basis`` records what it rests on,
so a reader can tell a measured effect from the absence of one:

    ``estimate``     binned from a percent estimate (tiers A, B and C). The
                     evidence tier says how far to trust it.
    ``projection``   binned from a modelled projection (tier D only); nothing
                     has been measured.
    ``never_bound``  the policy never applied to anyone (stayed or vacated
                     before compliance), so its effect is zero by construction.
    ``unquantified`` nobody has quantified the effect; the score is 0 and means
                     "no quantified effect", **not** "no effect". Show it as
                     "not estimated".

Confidence (0-1) is how far to trust the estimate itself, and is set by hand
for every ``estimate`` and ``projection`` link (it is NULL otherwise). Rubric:

    0.7-1.0   several independent studies agree on sign and rough size
    0.4-0.7   one or two credible studies, robust across the checks they report
    0.2-0.4   one study with fragile, specification-sensitive or conflicting
              results, or an unfinished (not yet DOI-bearing) paper
    < 0.2     a model projection, or evidence that is largely indirect

Tiers describe the *design* of the evidence and confidence describes this
particular number; the two are reported side by side and never combined.
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

SCORE_BASES = ("estimate", "projection", "never_bound", "unquantified")


def score_basis(tier: str, has_estimate: bool, never_bound: bool) -> str:
    """Return the ``score_basis`` for a link.

    A link with a number rests on ``estimate`` (tiers A-C) or ``projection``
    (tier D). One without a number is ``never_bound`` if the policy never
    applied to anyone, and ``unquantified`` otherwise.
    """
    if has_estimate:
        return "projection" if tier == "D" else "estimate"
    return "never_bound" if never_bound else "unquantified"


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
