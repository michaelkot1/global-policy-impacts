"""Staggered difference-in-differences / event study for state RPS and RGGI (tier B).

Estimates how much a state policy changed CO2, relative to states without it, and writes the
result to ``policy_effects`` as an evidence-tier **B** row (this site's own estimate) beside
any published row for the same policy. Run on its own::

    cd pipeline && uv run python -m analysis.event_study --db ../data/app.db

``build_db.py`` calls :func:`run_event_study` after the policy catalog is loaded.

Design
------
* **Treatment.** Read from ``policy_applicability``: a state is treated in a calendar year if
  an applicability row covers the *whole* year. Event time 0 is therefore the first full
  year of the policy, and a policy that starts mid-year counts from the next January.
  ``state-rps`` (about 30 states, adopted 1983-2015) and ``rggi`` (ten states in 2009,
  Virginia in 2021) are analysed; both are staggered, so a plain two-way fixed-effects
  regression would be biased by already-treated states acting as controls.
* **Estimator.** The imputation estimator of Borusyak, Jaravel and Spiess (2024). Fit
  ``y_it = state_i + year_t + controls_it`` by least squares on *untreated* state-years only
  (never-treated states, plus treated states before adoption), predict the untreated outcome
  for every treated state-year, and average the gaps. This is the "state and year fixed
  effects, controlling for population (and GDP)" model of the plan, made robust to effects
  that differ by cohort and over time. Effects are averaged over treated state-years, so
  each adopting state counts in proportion to how long it is observed (states are not
  weighted by size).
* **Outcomes**, in logs so that effects read as percent changes:
  ``co2_per_capita`` (total energy-related CO2 per person) and ``co2_power`` (electric-power
  sector CO2). States whose power-sector CO2 falls below ``MIN_POWER_MT`` in any year (DC, ID,
  OR, VT, WA) are dropped from the power outcome because their logs are dominated by noise
  and undefined at zero.
* **Headline estimate.** Mean effect over event times 0 to ``H_MAX`` (ten years), converted
  from log points to percent change as ``100 * (exp(b) - 1)``. The headline window is
  1990-2022 (the era of the published RPS and RGGI studies, and after the 1970s-80s fuel
  switching that moved regional power sectors apart for unrelated reasons) with state and
  year fixed effects and a control for log population. A treated state needs ``K_LEADS + 1``
  untreated years in the window so the pre-trend leads leave a baseline year, which drops
  Iowa (1983) and Minnesota (1994) from the RPS sample. Robustness checks, stored beside the
  headline: the full 1970-2022 panel, no controls, adding log GDP per capita (the plan asks
  for GDP, but BEA publishes it only from 1997, so only cohorts adopting from 2000 qualify,
  and GDP is a poor control because policy can move it) and keeping states that left the
  program as treated from first adoption.
* **Inference.** 95 % intervals are percentile intervals from a pairs bootstrap over states
  (each draw reweights whole states, ``REPS`` draws for the headline). With few treated
  states (RGGI has nine) bootstrap intervals can be too narrow, so a randomisation-inference
  p-value is also reported: the treatment paths are shuffled across states and the estimate
  recomputed. Pre-trends are tested by adding the ``K_LEADS`` years before adoption as
  dummies in the untreated-sample regression and testing them jointly (state-clustered
  Wald F). Lead coefficients are drawn on the event-study chart.
* **Dropped states.** Policies that switched off again inside the window (Kansas RPS from
  2016, New Jersey in RGGI 2012-2019) are dropped from the headline sample and added back as
  treated-from-first-adoption in the ``include_reversals`` check. Controls exposed to a
  different, comparable program are dropped (California's cap-and-trade for RGGI; Virginia's
  2020 Clean Economy Act for RPS).
* **Confidence** (0-1, the ``policy_effects.confidence`` field) follows a fixed rubric
  starting from 0.5 (one design, run with checks): minus 0.15 if the pre-trend test rejects
  at 10 %, minus 0.15 if any robustness check flips the sign, minus 0.10 if the
  randomisation-inference p-value is above 0.10; never below 0.1. It describes trust in the
  number and is kept separate from the impact score (which only bins the size of the effect).

Limits the reader should know: parallel trends (that treated states would have followed the
controls) is an assumption the pre-trend test can contradict but never prove; RGGI began in
the 2008-09 recession and the shale-gas boom; most RGGI states also have an RPS; and the
RPS control states are mostly in the South and Mountain West.
"""

from __future__ import annotations

import argparse
import logging
import sqlite3
import sys
import warnings
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd
import statsmodels.api as sm

import schema
import seed
from policies.scoring import impact_score

logger = logging.getLogger(__name__)

H_MAX = 10  # post-adoption event times 0..H_MAX enter the headline average
K_LEADS = 5  # pre-adoption years tested for pre-trends
MIN_STATES_PER_EVENT_TIME = 3  # suppress event-time coefficients resting on fewer treated states
MIN_POWER_MT = 0.1  # million metric tons; power-sector logs below this are not usable
GDP_FIRST_YEAR = 1997  # first year of BEA state GDP
HEADLINE_FIRST_YEAR = 1990  # start of the headline window
REPS = 999  # bootstrap draws and permutations for each headline estimate
ROBUST_REPS = 299  # bootstrap draws for each robustness check
SEED = 20261028
RIDGE = 1e-8  # keeps the normal equations solvable when a state or year has zero weight
NEVER = -10_000  # event time of a state that is never treated

METHOD_CITATIONS = (
    # (title, authors, year, doi, url, source name)
    (
        "Revisiting Event-Study Designs: Robust and Efficient Estimation",
        "Kirill Borusyak; Xavier Jaravel; Jann Spiess",
        2024,
        "10.1093/restud/rdae007",
        "https://doi.org/10.1093/restud/rdae007",
        "Oxford University Press journals",
    ),
    (
        "State Energy-Related Carbon Dioxide Emissions by Year",
        "U.S. Energy Information Administration",
        None,
        None,
        "https://www.eia.gov/environment/emissions/state/",
        "EIA State CO2 Emissions",
    ),
    (
        "Annual State Resident Population Estimates, 1970-present",
        "U.S. Census Bureau",
        None,
        None,
        "https://www.census.gov/programs-surveys/popest.html",
        "Census Population Estimates",
    ),
    (
        "Gross Domestic Product by State (SAGDP)",
        "U.S. Bureau of Economic Analysis",
        None,
        None,
        "https://www.bea.gov/data/gdp/gdp-state",
        "BEA State GDP",
    ),
)


# ── Configuration ───────────────────────────────────────────────────────

@dataclass(frozen=True)
class Outcome:
    key: str  # stored in policy_effects.outcome
    label: str
    description: str


OUTCOMES = {
    "co2_per_capita": Outcome(
        "co2_per_capita",
        "total energy-related CO2 per person",
        "log of total energy-related CO2 per capita",
    ),
    "co2_power": Outcome(
        "co2_power",
        "electric-power-sector CO2",
        "log of electric-power-sector CO2",
    ),
}


@dataclass(frozen=True)
class PolicyDesign:
    slug: str
    label: str
    outcomes: tuple[str, ...]
    exclude: dict[str, str] = field(default_factory=dict)  # state -> why it is not a clean control


POLICIES = (
    PolicyDesign(
        slug="rggi",
        label="RGGI",
        outcomes=("co2_power", "co2_per_capita"),
        exclude={"CA": "its own cap-and-trade program (AB 32) starts in 2013"},
    ),
    PolicyDesign(
        slug="state-rps",
        label="state RPS",
        outcomes=("co2_power", "co2_per_capita"),
        exclude={"VA": "its binding Clean Economy Act (2020) is catalogued as a separate policy"},
    ),
)


@dataclass(frozen=True)
class Spec:
    name: str
    description: str
    controls: tuple[str, ...]
    first_year: int | None = None  # None = start of the CO2 panel
    reversals: str = "drop"  # 'drop' or 'itt' (treated from first adoption on)
    min_pre: int = 3  # a treated state needs this many untreated years before adoption


# The headline window starts in 1990, the era of the published RPS and RGGI studies and after the
# 1970s-80s oil-to-coal and nuclear fuel switching that moved Northeast and Southern power
# sectors apart for reasons unrelated to these policies. A treated state needs K_LEADS + 1
# untreated years so the pre-trend leads leave a baseline year, which drops Iowa (1983) and
# Minnesota (1994) from the RPS sample; the since_1970 check puts them back.
HEADLINE = Spec(
    "headline",
    f"state and year fixed effects, control for log population, {HEADLINE_FIRST_YEAR}-2022",
    ("log_pop",),
    first_year=HEADLINE_FIRST_YEAR,
    min_pre=K_LEADS + 1,
)
ROBUSTNESS = (
    Spec("since_1970", "headline model on the full 1970-2022 panel", ("log_pop",)),
    Spec("no_controls", f"state and year fixed effects only, {HEADLINE_FIRST_YEAR}-2022", (), first_year=HEADLINE_FIRST_YEAR),
    Spec(
        "gdp_controls",
        "adds log GDP per capita; BEA data start in 1997, so only states adopting from 2000 qualify",
        ("log_pop", "log_gdppc"),
        first_year=GDP_FIRST_YEAR,
    ),
    Spec(
        "include_reversals",
        "headline model, but states that later left the program stay treated from first adoption",
        ("log_pop",),
        first_year=HEADLINE_FIRST_YEAR,
        min_pre=K_LEADS + 1,
        reversals="itt",
    ),
)


# ── Reading the database ────────────────────────────────────────────────

def load_panel(conn: sqlite3.Connection) -> pd.DataFrame:
    """State-year panel: ``co2_total``, ``co2_power`` (Mt), ``pop`` (persons), ``gdp`` ($M)."""
    rows = conn.execute(
        """
        SELECT j.code, o.year, m.slug, o.sector, o.value
        FROM observations o
        JOIN metrics m ON m.id = o.metric_id
        JOIN jurisdictions j ON j.id = o.jurisdiction_id
        WHERE j.type = 'state'
          AND ((m.slug = 'co2' AND o.sector IN ('total', 'electric_power'))
               OR m.slug IN ('population', 'gdp'))
        """
    ).fetchall()
    abbr = {fips: code for fips, code, _name in seed.US_STATES}
    names = {
        ("co2", "total"): "co2_total",
        ("co2", "electric_power"): "co2_power",
        ("population", None): "pop",
        ("gdp", None): "gdp",
    }
    frame = pd.DataFrame(rows, columns=["fips", "year", "slug", "sector", "value"])
    frame["state"] = frame["fips"].map(abbr)
    frame["col"] = [names[(s, sec if s == "co2" else None)] for s, sec in zip(frame.slug, frame.sector)]
    panel = frame.pivot_table(index=["state", "year"], columns="col", values="value").reset_index()
    for col in ("co2_total", "co2_power", "pop", "gdp"):
        if col not in panel:
            panel[col] = np.nan
    panel = panel.dropna(subset=["co2_total", "pop"]).sort_values(["state", "year"])
    panel["log_pop"] = np.log(panel["pop"])
    panel["log_gdppc"] = np.log(panel["gdp"] / panel["pop"])
    return panel.reset_index(drop=True)


def treatment_paths(
    conn: sqlite3.Connection, slug: str, years: np.ndarray
) -> dict[str, np.ndarray]:
    """For each state, a boolean array over *years*: was the policy in force all year?"""
    abbr = {fips: code for fips, code, _name in seed.US_STATES}
    rows = conn.execute(
        """
        SELECT j.code, a.start_date, a.end_date
        FROM policy_applicability a
        JOIN policies p ON p.id = a.policy_id
        JOIN jurisdictions j ON j.id = a.jurisdiction_id
        WHERE p.slug = ? AND j.type = 'state'
        """,
        (slug,),
    ).fetchall()
    paths: dict[str, np.ndarray] = {}
    for fips, start, end in rows:
        path = paths.setdefault(abbr[fips], np.zeros(len(years), dtype=bool))
        for i, year in enumerate(years):
            covered = (start or "0000-01-01") <= f"{year}-01-01" and (end is None or end >= f"{year}-12-31")
            path[i] |= covered
    return paths


# ── Sample and design ───────────────────────────────────────────────────

@dataclass
class Design:
    """One estimation sample as flat arrays over state-years."""

    states: list[str]
    years: np.ndarray  # distinct years in the sample
    state_idx: np.ndarray
    year_idx: np.ndarray
    y: np.ndarray
    X: np.ndarray  # state dummies, year dummies (first dropped), controls
    XL: np.ndarray  # X plus one dummy per lead year
    path: np.ndarray  # (S, T) treatment path per state
    cohort: np.ndarray  # (S,) first treated year, 0 if never treated
    D: np.ndarray  # treated state-year
    rel: np.ndarray  # event time (NEVER for never-treated states)
    dropped: dict[str, str]
    n_leads_cols: int

    @property
    def n_states(self) -> int:
        return len(self.states)

    @property
    def treated_state(self) -> np.ndarray:
        return self.cohort > 0

    @property
    def n_treated(self) -> int:
        return int(self.treated_state.sum())

    @property
    def n_control(self) -> int:
        return int((~self.treated_state).sum())

    def assign(self, perm: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Treatment indicator and event time if state *s* had state ``perm[s]``'s path."""
        src = perm[self.state_idx]
        D = self.path[src, self.year_idx]
        g = self.cohort[src]
        rel = np.where(g > 0, self.years[self.year_idx] - g, NEVER)
        return D, rel


def build_design(
    panel: pd.DataFrame,
    paths: dict[str, np.ndarray],
    path_years: np.ndarray,
    policy: PolicyDesign,
    outcome: Outcome,
    spec: Spec,
) -> Design | None:
    """Assemble the sample for one policy, outcome and specification."""
    df = panel.copy()
    if outcome.key == "co2_per_capita":
        df["y"] = np.log(df["co2_total"] / df["pop"])
    else:
        df["y"] = np.log(df["co2_power"].where(df["co2_power"] > 0))

    dropped: dict[str, str] = {}
    if outcome.key == "co2_power":
        low = df.groupby("state")["co2_power"].min()
        for state in low.index[low < MIN_POWER_MT]:
            dropped[state] = f"power-sector CO2 below {MIN_POWER_MT} Mt in some year"
    for state, reason in policy.exclude.items():
        dropped.setdefault(state, f"not a clean control: {reason}")

    first_year = spec.first_year or int(df["year"].min())
    df = df[df["year"] >= first_year]
    df = df.dropna(subset=["y", *spec.controls])
    df = df[~df["state"].isin(dropped)]

    index_of = {int(y): i for i, y in enumerate(path_years)}
    keep: list[str] = []
    cohort: dict[str, int] = {}
    path_by_state: dict[str, np.ndarray] = {}
    for state, grp in df.groupby("state"):
        years = grp["year"].to_numpy(int)
        raw = paths.get(state)
        path = np.array([bool(raw[index_of[y]]) if raw is not None else False for y in years])
        if path.any():
            first_idx = int(np.argmax(path))
            g = int(years[first_idx])
            if first_idx < spec.min_pre:
                dropped[state] = f"treated from {g}, fewer than {spec.min_pre} untreated years in sample"
                continue
            if not path[first_idx:].all():
                if spec.reversals == "drop":
                    dropped[state] = "policy switched off again within the sample"
                    continue
                path[first_idx:] = True
            cohort[state] = g
        keep.append(state)
        path_by_state[state] = path
    df = df[df["state"].isin(keep)]
    states = sorted(keep)
    if not any(s in cohort for s in states) or all(s in cohort for s in states):
        return None

    years = np.array(sorted(df["year"].unique()), dtype=int)
    year_pos = {int(y): i for i, y in enumerate(years)}
    state_pos = {s: i for i, s in enumerate(states)}
    df = df.sort_values(["state", "year"])
    state_idx = df["state"].map(state_pos).to_numpy(int)
    year_idx = df["year"].map(year_pos).to_numpy(int)
    S, T, N = len(states), len(years), len(df)

    path = np.zeros((S, T), dtype=bool)
    for state in states:
        have = df.loc[df["state"] == state, "year"].to_numpy(int)
        path[state_pos[state], [year_pos[int(y)] for y in have]] = path_by_state[state][
            : len(have)
        ]
    g_arr = np.array([cohort.get(s, 0) for s in states])

    X = np.zeros((N, S + (T - 1) + len(spec.controls)))
    X[np.arange(N), state_idx] = 1.0
    later = year_idx > 0
    X[np.flatnonzero(later), S + year_idx[later] - 1] = 1.0
    for j, col in enumerate(spec.controls):
        values = df[col].to_numpy(float)
        X[:, S + T - 1 + j] = values - values.mean()

    D = path[state_idx, year_idx]
    g_obs = g_arr[state_idx]
    rel = np.where(g_obs > 0, years[year_idx] - g_obs, NEVER)
    lead_cols = np.zeros((N, K_LEADS))
    for k in range(K_LEADS):
        lead_cols[:, k] = rel == -(K_LEADS - k)  # columns for h = -K..-1
    return Design(
        states=states,
        years=years,
        state_idx=state_idx,
        year_idx=year_idx,
        y=df["y"].to_numpy(float),
        X=X,
        XL=np.hstack([X, lead_cols]),
        path=path,
        cohort=g_arr,
        D=D,
        rel=rel,
        dropped=dropped,
        n_leads_cols=K_LEADS,
    )


# ── Estimation ──────────────────────────────────────────────────────────

def _solve(X: np.ndarray, y: np.ndarray, w: np.ndarray) -> np.ndarray:
    """Weighted least squares through the normal equations (fast enough to bootstrap)."""
    Xw = X * w[:, None]
    A = X.T @ Xw
    A.flat[:: A.shape[0] + 1] += RIDGE
    return np.linalg.solve(A, Xw.T @ y)


@dataclass
class Fit:
    att: float  # mean effect over event times 0..H_MAX, log points
    dyn: np.ndarray  # (H_MAX + 1,) mean effect by event time, NaN if none
    lead: np.ndarray  # (K_LEADS,) lead coefficients for h = -K..-1, NaN if not computed


def fit(
    d: Design, w_state: np.ndarray, perm: np.ndarray | None = None, leads: bool = False
) -> Fit:
    """Imputation estimate with state weights *w_state* (all ones = the real sample)."""
    D, rel = (d.D, d.rel) if perm is None else d.assign(perm)
    w_obs = w_state[d.state_idx]
    beta = _solve(d.X, d.y, w_obs * ~D)
    tau = d.y - d.X @ beta
    post = D & (rel >= 0) & (rel <= H_MAX)
    w_post = w_obs[post]
    total = w_post.sum()
    att = float((w_post * tau[post]).sum() / total) if total > 0 else np.nan
    num = np.bincount(rel[post], weights=w_post * tau[post], minlength=H_MAX + 1)
    den = np.bincount(rel[post], weights=w_post, minlength=H_MAX + 1)
    dyn = np.divide(num, den, out=np.full(H_MAX + 1, np.nan), where=den > 0)
    lead = np.full(K_LEADS, np.nan)
    if leads:
        beta_l = _solve(d.XL, d.y, w_obs * ~D)
        lead = beta_l[d.X.shape[1] :]
        lead = np.where(d.XL[:, d.X.shape[1] :].T @ w_obs > 0, lead, np.nan)
    return Fit(att, dyn, lead)


def pretrend_test(d: Design) -> tuple[float, float, int]:
    """Joint state-clustered Wald F test that the lead coefficients are zero."""
    untreated = ~d.D
    lead_block = d.XL[:, d.X.shape[1] :]
    usable = np.flatnonzero(lead_block[untreated].sum(axis=0) > 0)
    if len(usable) == 0:
        return np.nan, np.nan, 0
    cols = np.concatenate([np.arange(d.X.shape[1]), d.X.shape[1] + usable])
    with warnings.catch_warnings():
        # The fixed-effect dummies are collinear by construction; the lead coefficients are
        # still identified, and statsmodels' pseudo-inverse handles the rest.
        warnings.simplefilter("ignore", category=RuntimeWarning)
        warnings.simplefilter("ignore", category=sm.tools.sm_exceptions.ValueWarning)
        model = sm.OLS(d.y[untreated], d.XL[untreated][:, cols]).fit(
            cov_type="cluster",
            cov_kwds={"groups": d.state_idx[untreated]},
            use_t=True,
        )
    R = np.zeros((len(usable), len(cols)))
    R[np.arange(len(usable)), d.X.shape[1] + np.arange(len(usable))] = 1.0
    test = model.wald_test(R, use_f=True, scalar=True)
    return float(test.statistic), float(test.pvalue), len(usable)


def _pct(log_points: np.ndarray | float) -> np.ndarray | float:
    return 100.0 * np.expm1(log_points)


@dataclass
class Result:
    spec: Spec
    design: Design
    att: float
    se: float
    ci: tuple[float, float]  # 95 % percentile bootstrap interval, log points
    p_boot: float
    dyn: np.ndarray
    dyn_ci: np.ndarray  # (2, H_MAX + 1)
    lead: np.ndarray
    lead_ci: np.ndarray  # (2, K_LEADS)
    n_states_dyn: np.ndarray  # treated states observed at each event time, h = -K..H_MAX
    pretrend_p: float = np.nan
    pretrend_F: float = np.nan
    pretrend_n: int = 0
    ri_p: float = np.nan


def run_spec(
    d: Design, spec: Spec, reps: int, rng: np.random.Generator, leads: bool
) -> Result:
    """Point estimate plus a pairs-bootstrap (over states) interval for one design."""
    S = d.n_states
    base = fit(d, np.ones(S), leads=leads)
    draws_att = np.full(reps, np.nan)
    draws_dyn = np.full((reps, H_MAX + 1), np.nan)
    draws_lead = np.full((reps, K_LEADS), np.nan)
    treated = d.treated_state
    for b in range(reps):
        while True:
            counts = rng.multinomial(S, np.full(S, 1.0 / S)).astype(float)
            if counts[treated].sum() > 0 and counts[~treated].sum() > 0:
                break
        f = fit(d, counts, leads=leads)
        draws_att[b], draws_dyn[b], draws_lead[b] = f.att, f.dyn, f.lead
    ok = ~np.isnan(draws_att)
    ci = tuple(np.percentile(draws_att[ok], [2.5, 97.5]))
    p_boot = float(np.mean(np.abs(draws_att[ok] - base.att) >= abs(base.att)))
    with np.errstate(all="ignore"):
        dyn_ci = np.nanpercentile(draws_dyn, [2.5, 97.5], axis=0)
        lead_ci = np.nanpercentile(draws_lead, [2.5, 97.5], axis=0) if leads else np.full((2, K_LEADS), np.nan)

    # treated states observed at each event time
    n_dyn = np.zeros(K_LEADS + H_MAX + 1, dtype=int)
    for h in range(-K_LEADS, H_MAX + 1):
        sel = (d.rel == h) if h < 0 else (d.D & (d.rel == h))
        n_dyn[h + K_LEADS] = len(np.unique(d.state_idx[sel]))
    return Result(
        spec=spec,
        design=d,
        att=base.att,
        se=float(np.std(draws_att[ok], ddof=1)),
        ci=(float(ci[0]), float(ci[1])),
        p_boot=p_boot,
        dyn=base.dyn,
        dyn_ci=dyn_ci,
        lead=base.lead,
        lead_ci=lead_ci,
        n_states_dyn=n_dyn,
    )


def randomisation_p(d: Design, att: float, perms: int, rng: np.random.Generator) -> float:
    """Share of random re-assignments of the treatment paths with an effect as large as ours."""
    ones = np.ones(d.n_states)
    stats_ = []
    for _ in range(perms):
        f = fit(d, ones, perm=rng.permutation(d.n_states))
        if not np.isnan(f.att):
            stats_.append(f.att)
    stats_ = np.array(stats_)
    return float((1 + np.sum(np.abs(stats_) >= abs(att))) / (1 + len(stats_)))


@dataclass
class Analysis:
    policy: PolicyDesign
    outcome: Outcome
    headline: Result
    checks: dict[str, Result]
    confidence: float
    confidence_notes: list[str]
    reps: int = REPS
    robust_reps: int = ROBUST_REPS


def confidence_rubric(headline: Result, checks: dict[str, Result]) -> tuple[float, list[str]]:
    """Deterministic trust score for the headline number (see the module docstring)."""
    score, notes = 0.5, []
    if not np.isnan(headline.pretrend_p) and headline.pretrend_p < 0.10:
        score -= 0.15
        notes.append(f"pre-trend test rejects (p={headline.pretrend_p:.2f})")
    flipped = [n for n, r in checks.items() if np.sign(r.att) != np.sign(headline.att)]
    if flipped:
        score -= 0.15
        notes.append("sign flips in " + ", ".join(flipped))
    if not np.isnan(headline.ri_p) and headline.ri_p > 0.10:
        score -= 0.10
        notes.append(f"randomisation-inference p={headline.ri_p:.2f}")
    return round(max(score, 0.1), 2), notes


def analyze(
    panel: pd.DataFrame,
    conn: sqlite3.Connection,
    policy: PolicyDesign,
    outcome: Outcome,
    *,
    reps: int = REPS,
    robust_reps: int = ROBUST_REPS,
    seed_: int = SEED,
    policy_index: int = 0,
) -> Analysis | None:
    years = np.arange(int(panel["year"].min()), int(panel["year"].max()) + 1)
    paths = treatment_paths(conn, policy.slug, years)
    out_index = list(OUTCOMES).index(outcome.key)

    def rng_for(k: int) -> np.random.Generator:
        return np.random.default_rng(np.random.SeedSequence([seed_, policy_index, out_index, k]))

    d = build_design(panel, paths, years, policy, outcome, HEADLINE)
    if d is None or d.n_treated < 3:
        logger.warning("%s / %s: too few treated states, skipped", policy.slug, outcome.key)
        return None
    head = run_spec(d, HEADLINE, reps, rng_for(0), leads=True)
    head.pretrend_F, head.pretrend_p, head.pretrend_n = pretrend_test(d)
    head.ri_p = randomisation_p(d, head.att, reps, rng_for(1))

    checks: dict[str, Result] = {}
    for k, spec in enumerate(ROBUSTNESS, start=2):
        dd = build_design(panel, paths, years, policy, outcome, spec)
        if dd is None or dd.n_treated < 3:
            logger.warning("%s / %s: check %s has too few treated states", policy.slug, outcome.key, spec.name)
            continue
        checks[spec.name] = run_spec(dd, spec, robust_reps, rng_for(k), leads=False)
    conf, notes = confidence_rubric(head, checks)
    return Analysis(policy, outcome, head, checks, conf, notes, reps, robust_reps)


# ── Writing ─────────────────────────────────────────────────────────────

def _citation_ids(conn: sqlite3.Connection) -> list[int]:
    ids = []
    for title, authors, year, doi, url, source_name in METHOD_CITATIONS:
        row = conn.execute("SELECT id FROM sources WHERE name = ?", (source_name,)).fetchone()
        source_id = row[0] if row else None
        found = None
        if doi:
            found = conn.execute("SELECT id FROM citations WHERE doi = ?", (doi,)).fetchone()
        if found is None:
            found = conn.execute(
                "SELECT id FROM citations WHERE title = ? AND COALESCE(year, 0) = COALESCE(?, 0)",
                (title, year),
            ).fetchone()
        if found:
            ids.append(found[0])
            continue
        cur = conn.execute(
            "INSERT INTO citations (source_id, title, authors, year, doi, url) VALUES (?, ?, ?, ?, ?, ?)",
            (source_id, title, authors, year, doi, url),
        )
        ids.append(int(cur.lastrowid))
    return ids


def _fmt_pct(x: float) -> str:
    return f"{x:+.1f}%"


def _describe(a: Analysis) -> tuple[str, str]:
    """(scope, method) text for the policy_effects row."""
    h, d = a.headline, a.headline.design
    scope = (
        f"{a.outcome.label}; average over the first {H_MAX + 1} years of {a.policy.label} "
        f"({d.n_treated} adopting states, compared with {d.n_control} states without it)"
    )
    dropped = "; ".join(f"{s} ({why})" for s, why in sorted(d.dropped.items()))
    method = (
        f"This site's own event study (tier B). Imputation difference-in-differences estimator of "
        f"Borusyak, Jaravel and Spiess (2024) on a {int(d.years.min())}-{int(d.years.max())} state "
        f"panel: state and year fixed effects and a control for log population are fitted on "
        f"untreated state-years, and the gap between actual and predicted {a.outcome.description} "
        f"is averaged over treated state-years with event time 0 to {H_MAX}, where year 0 is the "
        f"first full year the policy applied. The effect is the percent change implied by the "
        f"average log-point gap, 100*(exp(b)-1). The 95% interval is a percentile interval from a "
        f"{a.reps}-draw bootstrap over states, so it is a confidence interval and not a range "
        f"across specifications. Pre-trend test on the {h.pretrend_n} years before adoption: "
        f"p={h.pretrend_p:.2f}. Randomisation-inference p={h.ri_p:.3f}. Confidence {a.confidence:.2f}"
        + (f" ({'; '.join(a.confidence_notes)})" if a.confidence_notes else " (no penalties applied)")
        + ". Not a causal claim: it relies on parallel trends between adopting and non-adopting "
        "states and on no other policy changing at the same time."
        + (f" Dropped from the sample: {dropped}." if dropped else "")
    )
    return scope, method


def _store(conn: sqlite3.Connection, a: Analysis, citation_ids: list[int]) -> None:
    policy = conn.execute("SELECT id FROM policies WHERE slug = ?", (a.policy.slug,)).fetchone()
    metric = conn.execute("SELECT id, higher_is_better FROM metrics WHERE slug = 'co2'").fetchone()
    if policy is None or metric is None:
        raise RuntimeError(f"policy {a.policy.slug!r} or the co2 metric is missing; load the catalog first")
    policy_id, (metric_id, higher_is_better) = policy[0], metric
    h = a.headline
    est, lo, hi = (float(_pct(v)) for v in (h.att, *h.ci))
    scope, method = _describe(a)
    catalog = conn.execute(
        "SELECT mechanism FROM policy_effects WHERE policy_id = ? AND metric_id = ? "
        "AND estimate_source = 'catalog'",
        (policy_id, metric_id),
    ).fetchone()
    mechanism = (catalog[0] if catalog and catalog[0] else None) or (
        f"{a.policy.label} is expected to lower CO2 by shifting generation or demand away from fossil fuels."
    )

    old = conn.execute(
        "SELECT id FROM policy_effects WHERE policy_id = ? AND metric_id = ? "
        "AND estimate_source = 'event_study' AND outcome = ?",
        (policy_id, metric_id, a.outcome.key),
    ).fetchall()
    for (old_id,) in old:
        for table in ("policy_effect_citations", "policy_effect_event_time", "policy_effect_checks"):
            conn.execute(f"DELETE FROM {table} WHERE policy_effect_id = ?", (old_id,))
        conn.execute("DELETE FROM policy_effects WHERE id = ?", (old_id,))

    effect_id = conn.execute(
        "INSERT INTO policy_effects (policy_id, metric_id, mechanism, scope, expected_direction, "
        "evidence_tier, effect_estimate, effect_low, effect_high, effect_unit, method, impact_score, "
        "score_basis, confidence, estimate_source, outcome) "
        "VALUES (?, ?, ?, ?, 'decrease', 'B', ?, ?, ?, 'percent', ?, ?, 'estimate', ?, 'event_study', ?)",
        (
            policy_id, metric_id, mechanism, scope, est, lo, hi, method,
            impact_score(est, bool(higher_is_better)), a.confidence, a.outcome.key,
        ),
    ).lastrowid
    conn.executemany(
        "INSERT INTO policy_effect_citations (policy_effect_id, citation_id) VALUES (?, ?)",
        [(effect_id, cid) for cid in citation_ids],
    )

    # Event-time coefficients: leads from the pre-trend regression, post-adoption from imputation.
    rows = []
    for k in range(K_LEADS):
        n = int(h.n_states_dyn[k])
        if n >= MIN_STATES_PER_EVENT_TIME and not np.isnan(h.lead[k]):
            rows.append((effect_id, k - K_LEADS, float(_pct(h.lead[k])),
                         float(_pct(h.lead_ci[0, k])), float(_pct(h.lead_ci[1, k])), n))
    for k in range(H_MAX + 1):
        n = int(h.n_states_dyn[K_LEADS + k])
        if n >= MIN_STATES_PER_EVENT_TIME and not np.isnan(h.dyn[k]):
            rows.append((effect_id, k, float(_pct(h.dyn[k])),
                         float(_pct(h.dyn_ci[0, k])), float(_pct(h.dyn_ci[1, k])), n))
    conn.executemany(
        "INSERT INTO policy_effect_event_time (policy_effect_id, event_time, estimate, low, high, n_states) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        rows,
    )

    d = h.design
    checks = [
        (
            "headline", f"{HEADLINE.description}; {a.reps}-draw bootstrap over states",
            est, lo, hi, h.p_boot, d.n_treated, d.n_control, len(d.y),
        ),
        (
            "pretrend",
            f"joint test that the {h.pretrend_n} pre-adoption lead coefficients are zero "
            f"(state-clustered Wald F = {h.pretrend_F:.2f})",
            None, None, None, h.pretrend_p, d.n_treated, d.n_control, len(d.y),
        ),
        (
            "randomisation_inference",
            f"share of {a.reps} random re-assignments of treatment paths to states giving an effect "
            "at least this large in absolute value",
            None, None, None, h.ri_p, d.n_treated, d.n_control, len(d.y),
        ),
    ]
    for name, r in a.checks.items():
        checks.append(
            (
                f"robust:{name}", f"{r.spec.description}; {a.robust_reps}-draw bootstrap",
                float(_pct(r.att)), float(_pct(r.ci[0])), float(_pct(r.ci[1])), r.p_boot,
                r.design.n_treated, r.design.n_control, len(r.design.y),
            )
        )
    conn.executemany(
        "INSERT INTO policy_effect_checks (policy_effect_id, check_name, description, estimate, low, "
        "high, p_value, n_treated, n_control, n_obs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [(effect_id, *c) for c in checks],
    )


def format_summary(analyses: list[Analysis]) -> str:
    lines = [
        f"{'policy':<10} {'outcome':<15} {'effect':>8}  {'95% CI':<17} {'pre-trend p':>11} "
        f"{'RI p':>6} {'conf':>5}  treated/control"
    ]
    for a in analyses:
        h = a.headline
        lines.append(
            f"{a.policy.slug:<10} {a.outcome.key:<15} {_fmt_pct(_pct(h.att)):>8}  "
            f"[{_pct(h.ci[0]):+.1f}, {_pct(h.ci[1]):+.1f}]".ljust(56)
            + f" {h.pretrend_p:>10.2f} {h.ri_p:>6.3f} {a.confidence:>5.2f}  "
            f"{h.design.n_treated}/{h.design.n_control}"
        )
        for name, r in a.checks.items():
            lines.append(
                f"{'':<10} {'  ' + name:<15} {_fmt_pct(_pct(r.att)):>8}  "
                f"[{_pct(r.ci[0]):+.1f}, {_pct(r.ci[1]):+.1f}]  ({r.design.n_treated}/{r.design.n_control})"
            )
    return "\n".join(lines)


# ── Public API ──────────────────────────────────────────────────────────

def run_event_study(
    conn: sqlite3.Connection,
    *,
    reps: int = REPS,
    robust_reps: int = ROBUST_REPS,
    seed_: int = SEED,
) -> list[Analysis]:
    """Run the event study for every policy in :data:`POLICIES` and write tier-B rows.

    Needs the observations (CO2, population, GDP) and the policy catalog to be loaded.
    Re-running replaces this module's previous rows and leaves catalog rows alone.
    """
    schema.create_tables(conn)  # upgrades an older database in place
    panel = load_panel(conn)
    analyses: list[Analysis] = []
    for p_index, policy in enumerate(POLICIES):
        for key in policy.outcomes:
            logger.info("event study: %s / %s", policy.slug, key)
            result = analyze(
                panel, conn, policy, OUTCOMES[key],
                reps=reps, robust_reps=robust_reps, seed_=seed_, policy_index=p_index,
            )
            if result:
                analyses.append(result)
    with conn:
        citation_ids = _citation_ids(conn)
        for a in analyses:
            _store(conn, a, citation_ids)
    logger.info("wrote %d tier-B estimates", len(analyses))
    return analyses


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the RPS and RGGI event studies.")
    parser.add_argument("--db", default=str(Path(__file__).resolve().parents[2] / "data" / "app.db"))
    parser.add_argument("--reps", type=int, default=REPS, help="bootstrap draws and permutations (headline)")
    parser.add_argument("--robust-reps", type=int, default=ROBUST_REPS)
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    conn = sqlite3.connect(args.db)
    try:
        analyses = run_event_study(conn, reps=args.reps, robust_reps=args.robust_reps)
    finally:
        conn.close()
    print(format_summary(analyses))
    return 0


if __name__ == "__main__":
    sys.exit(main())
