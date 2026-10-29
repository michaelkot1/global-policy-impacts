"""QA: audit that every policy-effect row in data/app.db uses the right evidence tier.

The tier definitions are in the plan and on the methodology page:

    A  peer-reviewed quasi-experimental evidence (difference-in-differences, synthetic control, ...)
    B  this site's own event-study estimate, with a 95% interval and a pre-trend test
    C  a correlation or descriptive trend only
    D  a plausible mechanism, no measured effect (a modelled projection may be recorded)

The loader already enforces the structural rules (tier A needs a peer-reviewed DOI citation,
tiers A and B need an estimate). This script checks what the loader cannot, from the stored rows:

* A: the estimate comes from a named quasi-experimental or econometric design, and a
  peer-reviewed DOI-bearing citation is attached; its interval is labelled as a CI or as a range
  across specifications.
* B: the row is the site's own event study (``estimate_source = 'event_study'``), carries a 95%
  interval and a stored pre-trend test, and its confidence is lower when the test rejects.
* C: nothing in the text claims the effect was caused or measured as causal, and any number is
  explained as non-causal.
* D: no measured estimate: a number is allowed only when the method says it is a projection
  or model, and then ``score_basis`` must be 'projection'.
* Every row has at least one citation and a mechanism.
* Impact scores equal the score recomputed from the stored estimate (policies/scoring.py).
* Causal verbs ("caused", "led to", "resulted in", "reduced emissions by") do not appear in
  the mechanism text of tier C or D rows.

Run:  uv run python qa_tiers.py          (from ``pipeline/``; exits non-zero on any failure)
"""

from __future__ import annotations

import re
import sqlite3
import sys
from pathlib import Path

from policies.scoring import impact_score

DB = Path(__file__).resolve().parent.parent / "data" / "app.db"

DESIGN_WORDS = re.compile(
    r"difference-in-differences|synthetic control|event study|panel regression|"
    r"panel data|instrumental|regression discontinuity",
    re.I,
)
CAUSAL_VERBS = re.compile(
    r"\b(caused|causes|led to|resulted in|resulting from|reduced (?:emissions|co2)|cut (?:emissions|co2)|"
    r"(?:was|were|is) responsible for|due to the policy|thanks to)\b",
    re.I,
)
PROJECTION_WORDS = re.compile(r"projection|modell?ed|model comparison|simulation", re.I)


def main() -> int:
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    rows = con.execute(
        """
        SELECT e.id, p.slug, e.evidence_tier tier, e.estimate_source src, e.outcome, e.effect_estimate est,
               e.effect_low lo, e.effect_high hi, e.method, e.mechanism, e.scope, e.impact_score score,
               e.score_basis basis, e.confidence conf, e.expected_direction direction
        FROM policy_effects e JOIN policies p ON p.id = e.policy_id
        ORDER BY p.slug, e.evidence_tier, e.outcome
        """
    ).fetchall()

    problems: list[str] = []
    warnings: list[str] = []
    counts: dict[str, int] = {}
    for r in rows:
        tag = f"{r['slug']} [{r['tier']}{'/' + r['outcome'] if r['outcome'] else ''}]"
        counts[r["tier"]] = counts.get(r["tier"], 0) + 1
        cites = con.execute(
            "SELECT c.title, c.doi FROM policy_effect_citations pc JOIN citations c ON c.id = pc.citation_id "
            "WHERE pc.policy_effect_id = ?",
            (r["id"],),
        ).fetchall()
        text = " ".join(filter(None, [r["method"], r["mechanism"]]))

        if not cites:
            problems.append(f"{tag}: no citations")
        if not (r["mechanism"] or "").strip():
            problems.append(f"{tag}: no mechanism text")

        # impact score matches the stored estimate
        if r["est"] is not None and r["basis"] in ("estimate", "projection"):
            want = impact_score(r["est"], higher_is_better=False)
            if want != r["score"]:
                problems.append(f"{tag}: impact_score {r['score']} but estimate {r['est']:.2f}% scores {want}")
        elif r["est"] is None and r["score"] != 0:
            problems.append(f"{tag}: no estimate but impact_score {r['score']}")
        if r["est"] is not None and r["basis"] not in ("estimate", "projection"):
            problems.append(f"{tag}: has an estimate but score_basis is {r['basis']}")

        if r["tier"] == "A":
            if r["src"] != "catalog":
                problems.append(f"{tag}: tier A must be a published (catalog) estimate")
            if r["est"] is None:
                problems.append(f"{tag}: tier A without an estimate")
            if not DESIGN_WORDS.search(r["method"] or ""):
                problems.append(f"{tag}: tier A method does not name a quasi-experimental or panel design")
            if not any(c["doi"] for c in cites):
                problems.append(f"{tag}: tier A without a DOI citation")
            if r["lo"] is not None and not re.search(
                r"confidence interval|range across|span the|not a confidence interval|spans", r["method"] or "", re.I
            ):
                problems.append(f"{tag}: low/high are not described as a CI or a range")
            if not re.search(r"counterfactual|synthetic control|difference-in-differences", r["method"] or "", re.I):
                warnings.append(f"{tag}: tier A method does not mention a counterfactual comparison")
            if r["conf"] is None or r["conf"] > 0.7:
                problems.append(f"{tag}: tier A confidence {r['conf']} (single studies should not exceed 0.7)")

        elif r["tier"] == "B":
            if r["src"] != "event_study":
                problems.append(f"{tag}: tier B must come from this site's event study")
            if r["lo"] is None or r["hi"] is None:
                problems.append(f"{tag}: tier B without a 95% interval")
            pre = con.execute(
                "SELECT p_value FROM policy_effect_checks WHERE policy_effect_id=? AND check_name='pretrend'",
                (r["id"],),
            ).fetchone()
            if pre is None or pre["p_value"] is None:
                problems.append(f"{tag}: tier B without a stored pre-trend test")
            elif pre["p_value"] < 0.10 and (r["conf"] is None or r["conf"] > 0.40):
                problems.append(f"{tag}: pre-trend rejects (p={pre['p_value']:.3f}) but confidence is {r['conf']}")
            elif pre["p_value"] < 0.10:
                warnings.append(
                    f"{tag}: pre-trend test rejects (p={pre['p_value']:.4f}); shown as tier B with a warning "
                    f"and confidence {r['conf']}, not as causal"
                )
            if CAUSAL_VERBS.search(text):
                problems.append(f"{tag}: causal wording in a tier B row: {CAUSAL_VERBS.search(text).group(0)!r}")

        elif r["tier"] == "C":
            if r["src"] != "catalog":
                problems.append(f"{tag}: tier C from event_study")
            m = CAUSAL_VERBS.search(text)
            if m:
                problems.append(f"{tag}: causal wording in a tier C row: {m.group(0)!r}")
            if r["est"] is not None and not re.search(
                r"associat|sensitive|not (?:framed as )?causal|working paper|cannot support tier A", text, re.I
            ):
                problems.append(f"{tag}: tier C number is not explained as non-causal / not peer reviewed")

        elif r["tier"] == "D":
            m = CAUSAL_VERBS.search(text)
            if m:
                problems.append(f"{tag}: causal wording in a tier D row: {m.group(0)!r}")
            if r["est"] is not None:
                if not PROJECTION_WORDS.search(r["method"] or ""):
                    problems.append(f"{tag}: tier D number is not described as a projection or model")
                if r["basis"] != "projection":
                    problems.append(f"{tag}: tier D number must have score_basis 'projection'")

    print("Rows by tier:", dict(sorted(counts.items())), f"({len(rows)} total)")
    for w in warnings:
        print("  note:", w)
    print()
    if problems:
        print(f"FAILED ({len(problems)}):")
        for p in problems:
            print("  -", p)
        return 1
    print("OK: every tier assignment passes the audit.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
