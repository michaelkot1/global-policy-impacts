"""Load the hand-curated policy catalog from ``data/policies/*.yaml`` into the database.

Run on its own to validate the catalog without touching ``data/app.db``::

    cd pipeline && uv run python -m policies.load            # validate + dry load into memory
    cd pipeline && uv run python -m policies.load --db ../data/app.db

``build_db.py`` calls :func:`load_policies` after the schema and reference rows exist.

Catalog layout
--------------
``data/policies/`` holds YAML files in two groups:

* ``_sources.yaml`` and ``_citations.yaml`` are registries. Files whose names begin
  with an underscore are never treated as policy files.
* Every other ``*.yaml`` file has a top-level ``policies:`` list.

Sources registry (``sources: {key: {...}}``)
    name (required, unique), publisher, url, description.

Citations registry (``citations: {key: {...}}``)
    title (required), source (required, a key from the sources registry),
    authors, year, doi, url, peer_reviewed (default false), accessed (ISO date).

Policy record
    slug, title, kind, level, jurisdiction, status, summary, citations, effects (required);
    enacted, effective, repealed, url (optional).

    ``kind``       federal_law | executive_order | regulation | state_law |
                   interstate_program | international_agreement
    ``level``      federal | state | interstate | international (must suit ``kind``)
    ``jurisdiction``  the issuing jurisdiction: ``US`` or a two-letter state code. Interstate
                   programs and multi-state umbrella records use ``US`` as the enclosing
                   jurisdiction; who they bind is in ``applicability``.
    ``status``     enacted | repealed | blocked | expired | pending
    ``citations``  keys of documents that establish the policy (statute, rule, treaty text)

    ``applicability``: list of rows describing where and when obligations applied::

        - jurisdictions: all_states        # or [CA, NY] or [US]
          except: [AK, HI]                 # only with all_states
          start: 2000-01-01                # required
          end: 2020-12-31                  # omit = still in force
          notes: free text

    ``all_states`` expands to the 50 states and DC, one database row per jurisdiction.
    A policy whose obligations never bound (stayed or vacated before compliance began)
    has ``applicability: []`` and explains why in ``summary``. International agreements
    are recorded on the United States row, not on each state.

    ``effects``: one entry per metric the policy is linked to::

        - metric: co2                      # slug in the metrics table
          direction: increase | decrease | ambiguous
          tier: A | B | C | D
          scope: what the estimate or mechanism applies to
          mechanism: how the policy is expected to move the metric
          estimate / low / high / unit / method / confidence
          citations: [keys]                # at least one

Dates
-----
ISO 8601. ``YYYY`` and ``YYYY-MM`` are accepted for imprecise dates: start and
enacted/effective dates expand to the first day of the period and end and
repealed dates to the last. Applicability notes are annotated when this happens.

Evidence rules checked by the loader
------------------------------------
* Every effect cites at least one source that exists in the citations registry.
* Tier A requires a peer-reviewed citation with a DOI.
* Only tiers A and B may carry an effect estimate (C and D are descriptive).
* A percent estimate is converted to an impact score (see ``policies/scoring.py``);
  evidence strength is never folded into that score.
"""

from __future__ import annotations

import argparse
import calendar
import datetime as dt
import logging
import re
import sqlite3
import sys
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

import seed

from .scoring import impact_score

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent.parent.parent
POLICIES_DIR = ROOT / "data" / "policies"

KINDS = (
    "federal_law",
    "executive_order",
    "regulation",
    "state_law",
    "interstate_program",
    "international_agreement",
)
LEVELS = ("federal", "state", "interstate", "international")
KIND_LEVELS: dict[str, tuple[str, ...]] = {
    "federal_law": ("federal",),
    "executive_order": ("federal",),
    "regulation": ("federal", "state"),
    "state_law": ("state",),
    "interstate_program": ("interstate",),
    "international_agreement": ("international",),
}
STATUSES = ("enacted", "repealed", "blocked", "expired", "pending")
TIERS = ("A", "B", "C", "D")
DIRECTIONS = ("increase", "decrease", "ambiguous")

SOURCE_KEYS = {"name", "publisher", "url", "description"}
CITATION_KEYS = {"title", "source", "authors", "year", "doi", "url", "peer_reviewed", "accessed"}
POLICY_KEYS = {
    "slug", "title", "kind", "level", "jurisdiction", "enacted", "effective", "repealed",
    "status", "summary", "url", "citations", "applicability", "effects",
}
APPLICABILITY_KEYS = {"jurisdictions", "except", "start", "end", "notes"}
EFFECT_KEYS = {
    "metric", "direction", "tier", "scope", "mechanism", "estimate", "low", "high",
    "unit", "method", "confidence", "citations",
}

_SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_DOI_RE = re.compile(r"^10\.\d{4,9}/\S+$")
_DATE_RE = re.compile(r"^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$")

PRECISION_NOTE = (
    "Dates are given at year or month precision in the catalog; start dates are set to the "
    "first day and end dates to the last day of the period."
)


class CatalogError(ValueError):
    """Raised when the catalog fails validation; ``errors`` lists every problem found."""

    def __init__(self, errors: list[str]):
        self.errors = errors
        shown = "\n  - ".join(errors)
        super().__init__(f"{len(errors)} problem(s) in policy catalog:\n  - {shown}")


@dataclass
class Catalog:
    sources: dict[str, dict[str, Any]]
    citations: dict[str, dict[str, Any]]
    policies: list[dict[str, Any]]  # each carries "_file" for error messages


@dataclass
class Prepared:
    """Catalog resolved against the database and ready to insert."""

    sources: dict[str, dict[str, Any]]
    citations: dict[str, dict[str, Any]]
    policies: list[dict[str, Any]]
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


# ── Reading ─────────────────────────────────────────────────────────────

def _read_yaml(path: Path) -> Any:
    try:
        with path.open(encoding="utf-8") as fh:
            return yaml.safe_load(fh)
    except (yaml.YAMLError, ValueError) as exc:  # ValueError: impossible calendar dates
        raise CatalogError([f"{path.name}: invalid YAML: {exc}"]) from exc


def read_catalog(directory: Path | None = None) -> Catalog:
    """Parse the registries and every policy file in *directory*."""
    directory = Path(directory or POLICIES_DIR)
    errors: list[str] = []

    def registry(filename: str, key: str) -> dict[str, dict[str, Any]]:
        path = directory / filename
        if not path.exists():
            errors.append(f"{filename}: missing")
            return {}
        data = _read_yaml(path) or {}
        entries = data.get(key)
        if not isinstance(entries, dict):
            errors.append(f"{filename}: expected a top-level '{key}:' mapping")
            return {}
        return entries

    sources = registry("_sources.yaml", "sources")
    citations = registry("_citations.yaml", "citations")

    policies: list[dict[str, Any]] = []
    files = sorted(p for p in directory.glob("*.yaml") if not p.name.startswith("_"))
    if not files:
        errors.append(f"{directory}: no policy YAML files found")
    for path in files:
        data = _read_yaml(path) or {}
        entries = data.get("policies")
        if not isinstance(entries, list):
            errors.append(f"{path.name}: expected a top-level 'policies:' list")
            continue
        for entry in entries:
            if not isinstance(entry, dict):
                errors.append(f"{path.name}: every policy must be a mapping")
                continue
            policies.append({**entry, "_file": path.name})

    if errors:
        raise CatalogError(errors)
    return Catalog(sources=sources, citations=citations, policies=policies)


# ── Value parsing ───────────────────────────────────────────────────────

def parse_date(value: Any, *, end: bool = False) -> tuple[str | None, str | None]:
    """Normalise a catalog date to ``(iso_date, precision)``.

    *precision* is ``"day"``, ``"month"`` or ``"year"``. Imprecise dates expand to the
    first day of the period, or the last day when ``end`` is true.
    """
    if value is None or value == "":
        return None, None
    if isinstance(value, dt.datetime):
        return value.date().isoformat(), "day"
    if isinstance(value, dt.date):
        return value.isoformat(), "day"
    match = _DATE_RE.match(str(value).strip())
    if not match:
        raise ValueError(f"not an ISO date (YYYY, YYYY-MM or YYYY-MM-DD): {value!r}")
    year, month, day = match.group(1), match.group(2), match.group(3)
    if month is None:
        return (f"{year}-12-31" if end else f"{year}-01-01"), "year"
    if not 1 <= int(month) <= 12:
        raise ValueError(f"month out of range: {value!r}")
    last_day = calendar.monthrange(int(year), int(month))[1]
    if day is None:
        return f"{year}-{month}-{last_day:02d}" if end else f"{year}-{month}-01", "month"
    if not 1 <= int(day) <= last_day:
        raise ValueError(f"day out of range: {value!r}")
    return f"{year}-{month}-{day}", "day"


def _number(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"expected a number, got {value!r}")
    return float(value)


def _text(value: Any) -> str | None:
    if value is None:
        return None
    return " ".join(str(value).split())


# ── Database lookups ────────────────────────────────────────────────────

def _jurisdiction_ids(conn: sqlite3.Connection) -> dict[str, int]:
    """Map ``US`` and two-letter state codes to ``jurisdictions.id``."""
    by_code = {
        (kind, code): row_id
        for row_id, kind, code in conn.execute("SELECT id, type, code FROM jurisdictions")
    }
    ids: dict[str, int] = {}
    if ("country", "US") in by_code:
        ids["US"] = by_code[("country", "US")]
    for fips, abbr, _name in seed.US_STATES:
        if ("state", fips) in by_code:
            ids[abbr] = by_code[("state", fips)]
    return ids


def _metrics(conn: sqlite3.Connection) -> dict[str, tuple[int, bool]]:
    return {
        slug: (metric_id, bool(higher_is_better))
        for metric_id, slug, higher_is_better in conn.execute(
            "SELECT id, slug, higher_is_better FROM metrics"
        )
    }


# ── Validation and preparation ──────────────────────────────────────────

def _unknown_keys(entry: dict[str, Any], allowed: set[str], where: str, errors: list[str]) -> None:
    for key in sorted(set(entry) - allowed - {"_file"}):
        errors.append(f"{where}: unknown field '{key}'")


def _prepare_registries(catalog: Catalog, prepared: Prepared) -> None:
    errors = prepared.errors
    seen_names: set[str] = set()
    for key, src in catalog.sources.items():
        where = f"_sources.yaml: source '{key}'"
        if not isinstance(src, dict):
            errors.append(f"{where}: must be a mapping")
            continue
        _unknown_keys(src, SOURCE_KEYS, where, errors)
        name = _text(src.get("name"))
        if not name:
            errors.append(f"{where}: 'name' is required")
            continue
        if name in seen_names:
            errors.append(f"{where}: duplicate name {name!r}")
        seen_names.add(name)
        prepared.sources[key] = {
            "name": name,
            "publisher": _text(src.get("publisher")),
            "url": src.get("url"),
            "description": _text(src.get("description")),
        }

    for key, cit in catalog.citations.items():
        where = f"_citations.yaml: citation '{key}'"
        if not isinstance(cit, dict):
            errors.append(f"{where}: must be a mapping")
            continue
        _unknown_keys(cit, CITATION_KEYS, where, errors)
        title = _text(cit.get("title"))
        if not title:
            errors.append(f"{where}: 'title' is required")
            continue
        source_key = cit.get("source")
        if source_key not in catalog.sources:
            errors.append(f"{where}: source {source_key!r} is not in _sources.yaml")
        doi = cit.get("doi")
        if doi is not None and not _DOI_RE.match(str(doi)):
            errors.append(f"{where}: malformed DOI {doi!r}")
        if cit.get("peer_reviewed") and not doi:
            errors.append(f"{where}: peer_reviewed citations need a DOI")
        year = cit.get("year")
        if year is not None and (isinstance(year, bool) or not isinstance(year, int)):
            errors.append(f"{where}: year must be an integer")
        try:
            accessed, _ = parse_date(cit.get("accessed"))
        except ValueError as exc:
            errors.append(f"{where}: accessed: {exc}")
            accessed = None
        prepared.citations[key] = {
            "source_key": source_key,
            "title": title,
            "authors": _text(cit.get("authors")),
            "year": year,
            "doi": str(doi) if doi else None,
            "url": cit.get("url"),
            "accessed": accessed,
            "peer_reviewed": bool(cit.get("peer_reviewed", False)),
        }


def _expand_jurisdictions(
    spec: Any, exclude: Any, jur_ids: dict[str, int], where: str, errors: list[str]
) -> list[tuple[str, int]]:
    state_codes = [abbr for _fips, abbr, _name in seed.US_STATES]
    if spec == "all_states":
        codes = list(state_codes)
        if exclude is not None:
            if not isinstance(exclude, list):
                errors.append(f"{where}: 'except' must be a list of state codes")
                exclude = []
            for code in exclude:
                if code not in state_codes:
                    errors.append(f"{where}: unknown state code {code!r} in 'except'")
            codes = [c for c in codes if c not in (exclude or [])]
    elif isinstance(spec, list) and spec:
        if exclude is not None:
            errors.append(f"{where}: 'except' is only allowed with 'all_states'")
        codes = []
        for code in spec:
            if code not in jur_ids:
                errors.append(f"{where}: unknown jurisdiction {code!r}")
            elif code in codes:
                errors.append(f"{where}: jurisdiction {code!r} listed twice")
            else:
                codes.append(code)
    else:
        errors.append(f"{where}: 'jurisdictions' must be 'all_states' or a non-empty list of codes")
        return []
    return [(code, jur_ids[code]) for code in codes if code in jur_ids]


def _prepare_policy(
    entry: dict[str, Any],
    catalog: Catalog,
    prepared: Prepared,
    jur_ids: dict[str, int],
    metrics: dict[str, tuple[int, bool]],
) -> dict[str, Any] | None:
    slug = entry.get("slug")
    where = f"{entry['_file']}: policy '{slug}'"
    errors: list[str] = []

    _unknown_keys(entry, POLICY_KEYS, where, errors)
    if not isinstance(slug, str) or not _SLUG_RE.match(slug):
        errors.append(f"{where}: 'slug' must be lowercase words joined by hyphens")
    for required in ("title", "kind", "level", "jurisdiction", "status", "summary"):
        if not entry.get(required):
            errors.append(f"{where}: '{required}' is required")

    kind, level, status = entry.get("kind"), entry.get("level"), entry.get("status")
    if kind and kind not in KINDS:
        errors.append(f"{where}: kind {kind!r} is not one of {', '.join(KINDS)}")
    if level and level not in LEVELS:
        errors.append(f"{where}: level {level!r} is not one of {', '.join(LEVELS)}")
    if kind in KIND_LEVELS and level in LEVELS and level not in KIND_LEVELS[kind]:
        errors.append(f"{where}: kind {kind!r} cannot have level {level!r}")
    if status and status not in STATUSES:
        errors.append(f"{where}: status {status!r} is not one of {', '.join(STATUSES)}")

    jurisdiction = entry.get("jurisdiction")
    if jurisdiction and jurisdiction not in jur_ids:
        errors.append(f"{where}: unknown issuing jurisdiction {jurisdiction!r}")

    dates: dict[str, str | None] = {}
    for field_name, end in (("enacted", False), ("effective", False), ("repealed", True)):
        try:
            dates[field_name], _ = parse_date(entry.get(field_name), end=end)
        except ValueError as exc:
            errors.append(f"{where}: {field_name}: {exc}")
            dates[field_name] = None
    enacted, effective, repealed = dates["enacted"], dates["effective"], dates["repealed"]
    if enacted and effective and effective < enacted:
        errors.append(f"{where}: effective date {effective} is before enacted date {enacted}")
    if repealed and enacted and repealed < enacted:
        errors.append(f"{where}: repealed date {repealed} is before enacted date {enacted}")
    if status == "repealed" and not repealed:
        errors.append(f"{where}: status 'repealed' needs a 'repealed' date")

    # Policy-level citations
    policy_citations = entry.get("citations")
    if not isinstance(policy_citations, list) or not policy_citations:
        errors.append(f"{where}: 'citations' must list at least one source document")
        policy_citations = []
    for key in policy_citations:
        if key not in catalog.citations:
            errors.append(f"{where}: unknown citation {key!r}")

    # Applicability
    applicability: list[dict[str, Any]] = []
    rows = entry.get("applicability")
    if rows is None or not isinstance(rows, list):
        errors.append(f"{where}: 'applicability' is required (use [] if the policy never bound anyone)")
        rows = []
    for index, row in enumerate(rows, start=1):
        row_where = f"{where}, applicability #{index}"
        if not isinstance(row, dict):
            errors.append(f"{row_where}: must be a mapping")
            continue
        _unknown_keys(row, APPLICABILITY_KEYS, row_where, errors)
        try:
            start, start_precision = parse_date(row.get("start"))
            end, end_precision = parse_date(row.get("end"), end=True)
        except ValueError as exc:
            errors.append(f"{row_where}: {exc}")
            continue
        if not start:
            errors.append(f"{row_where}: 'start' is required")
            continue
        if end and end < start:
            errors.append(f"{row_where}: end {end} is before start {start}")
        if enacted and start < enacted:
            errors.append(f"{row_where}: start {start} is before the policy was enacted ({enacted})")
        if repealed and end and end > repealed:
            errors.append(f"{row_where}: end {end} is after the policy was repealed ({repealed})")
        if repealed and not end and status in ("repealed", "expired"):
            errors.append(f"{row_where}: needs an 'end' because the policy is {status}")
        notes = _text(row.get("notes"))
        if start_precision != "day" or (end and end_precision != "day"):
            notes = f"{notes} {PRECISION_NOTE}" if notes else PRECISION_NOTE
        for code, jur_id in _expand_jurisdictions(
            row.get("jurisdictions"), row.get("except"), jur_ids, row_where, errors
        ):
            applicability.append(
                {"code": code, "jurisdiction_id": jur_id, "start": start, "end": end, "notes": notes}
            )

    spans: dict[int, list[tuple[str, str | None, str]]] = {}
    for row in applicability:
        spans.setdefault(row["jurisdiction_id"], []).append((row["start"], row["end"], row["code"]))
    for spans_for_jur in spans.values():
        spans_for_jur.sort(key=lambda s: s[0])
        for (s1, e1, code), (s2, _e2, _c2) in zip(spans_for_jur, spans_for_jur[1:]):
            if e1 is None or s2 <= e1:
                errors.append(f"{where}: overlapping applicability for {code} ({s1}..{e1 or 'open'} and {s2})")

    # Effects
    effects: list[dict[str, Any]] = []
    raw_effects = entry.get("effects")
    if not isinstance(raw_effects, list) or not raw_effects:
        errors.append(f"{where}: 'effects' must list at least one metric link")
        raw_effects = []
    seen_metrics: set[str] = set()
    for index, eff in enumerate(raw_effects, start=1):
        eff_where = f"{where}, effect #{index}"
        if not isinstance(eff, dict):
            errors.append(f"{eff_where}: must be a mapping")
            continue
        _unknown_keys(eff, EFFECT_KEYS, eff_where, errors)
        metric_slug = eff.get("metric")
        if metric_slug not in metrics:
            errors.append(f"{eff_where}: unknown metric {metric_slug!r}")
            continue
        if metric_slug in seen_metrics:
            errors.append(f"{eff_where}: metric {metric_slug!r} listed twice (one effect per policy and metric)")
        seen_metrics.add(metric_slug)
        metric_id, higher_is_better = metrics[metric_slug]

        direction, tier = eff.get("direction"), eff.get("tier")
        if direction not in DIRECTIONS:
            errors.append(f"{eff_where}: direction must be one of {', '.join(DIRECTIONS)}")
        if tier not in TIERS:
            errors.append(f"{eff_where}: tier must be one of {', '.join(TIERS)}")
        if not eff.get("mechanism"):
            errors.append(f"{eff_where}: 'mechanism' is required")

        try:
            estimate, low, high = (_number(eff.get(k)) for k in ("estimate", "low", "high"))
            confidence = _number(eff.get("confidence"))
        except ValueError as exc:
            errors.append(f"{eff_where}: {exc}")
            estimate = low = high = confidence = None
        unit = _text(eff.get("unit"))
        has_numbers = any(v is not None for v in (estimate, low, high))
        if has_numbers and tier not in ("A", "B"):
            errors.append(f"{eff_where}: tier {tier} is descriptive; only tiers A and B may carry an estimate")
        if (low is not None or high is not None) and estimate is None:
            errors.append(f"{eff_where}: 'low'/'high' need an 'estimate'")
        if estimate is not None:
            if not unit:
                errors.append(f"{eff_where}: an estimate needs a 'unit'")
            if low is not None and low > estimate:
                errors.append(f"{eff_where}: low {low} is above the estimate {estimate}")
            if high is not None and high < estimate:
                errors.append(f"{eff_where}: high {high} is below the estimate {estimate}")
            if not eff.get("method"):
                errors.append(f"{eff_where}: an estimate needs a 'method'")
        if confidence is not None and not 0 <= confidence <= 1:
            errors.append(f"{eff_where}: confidence must be between 0 and 1")

        eff_citations = eff.get("citations")
        if not isinstance(eff_citations, list) or not eff_citations:
            errors.append(f"{eff_where}: every effect must cite at least one source")
            eff_citations = []
        missing = [k for k in eff_citations if k not in catalog.citations]
        for key in missing:
            errors.append(f"{eff_where}: unknown citation {key!r}")
        if tier == "A" and not any(
            prepared.citations.get(k, {}).get("peer_reviewed") for k in eff_citations
        ):
            errors.append(f"{eff_where}: tier A needs a peer-reviewed citation with a DOI")

        score = None
        if estimate is not None and unit == "percent":
            score = impact_score(estimate, higher_is_better)
        effects.append(
            {
                "metric_id": metric_id,
                "mechanism": _text(eff.get("mechanism")),
                "scope": _text(eff.get("scope")),
                "direction": direction,
                "tier": tier,
                "estimate": estimate,
                "low": low,
                "high": high,
                "unit": unit,
                "method": _text(eff.get("method")),
                "impact_score": score,
                "confidence": confidence,
                "citations": list(eff_citations),
                "metric": metric_slug,
            }
        )

    prepared.errors.extend(errors)
    if errors:
        return None
    return {
        "slug": slug,
        "title": _text(entry["title"]),
        "kind": kind,
        "level": level,
        "jurisdiction_id": jur_ids[jurisdiction],
        "enacted": enacted,
        "effective": effective,
        "repealed": repealed,
        "status": status,
        "summary": _text(entry["summary"]),
        "url": entry.get("url"),
        "citations": list(policy_citations),
        "applicability": applicability,
        "effects": effects,
    }


def prepare(catalog: Catalog, conn: sqlite3.Connection) -> Prepared:
    """Validate *catalog* against the database's jurisdictions and metrics."""
    prepared = Prepared(sources={}, citations={}, policies=[])
    jur_ids = _jurisdiction_ids(conn)
    if "US" not in jur_ids or len(jur_ids) < 52:
        prepared.errors.append(
            "database has no seeded jurisdictions (run schema.create_tables and seed.seed_all first)"
        )
        return prepared
    metrics = _metrics(conn)

    _prepare_registries(catalog, prepared)

    seen_slugs: set[str] = set()
    for entry in catalog.policies:
        slug = entry.get("slug")
        if slug in seen_slugs:
            prepared.errors.append(f"{entry['_file']}: duplicate slug {slug!r}")
            continue
        seen_slugs.add(slug)
        record = _prepare_policy(entry, catalog, prepared, jur_ids, metrics)
        if record:
            prepared.policies.append(record)

    used = {k for p in prepared.policies for k in p["citations"]}
    used |= {k for p in prepared.policies for e in p["effects"] for k in e["citations"]}
    for key in sorted(set(prepared.citations) - used):
        prepared.warnings.append(f"citation '{key}' is defined but never used")
    used_sources = {c["source_key"] for k, c in prepared.citations.items() if k in used}
    for key in sorted(set(prepared.sources) - used_sources):
        prepared.warnings.append(f"source '{key}' is defined but no cited document uses it")
    return prepared


# ── Writing ─────────────────────────────────────────────────────────────

def _upsert_source(conn: sqlite3.Connection, src: dict[str, Any]) -> int:
    row = conn.execute("SELECT id FROM sources WHERE name = ?", (src["name"],)).fetchone()
    if row:
        conn.execute(
            "UPDATE sources SET publisher = ?, url = ?, description = ? WHERE id = ?",
            (src["publisher"], src["url"], src["description"], row[0]),
        )
        return row[0]
    cur = conn.execute(
        "INSERT INTO sources (name, publisher, url, description) VALUES (?, ?, ?, ?)",
        (src["name"], src["publisher"], src["url"], src["description"]),
    )
    return int(cur.lastrowid)


def _upsert_citation(conn: sqlite3.Connection, cit: dict[str, Any], source_id: int) -> int:
    row = None
    if cit["doi"]:
        row = conn.execute("SELECT id FROM citations WHERE doi = ?", (cit["doi"],)).fetchone()
    if row is None:
        row = conn.execute(
            "SELECT id FROM citations WHERE title = ? AND COALESCE(year, 0) = COALESCE(?, 0)",
            (cit["title"], cit["year"]),
        ).fetchone()
    values = (
        source_id, cit["title"], cit["authors"], cit["year"], cit["doi"], cit["url"], cit["accessed"],
    )
    if row:
        conn.execute(
            "UPDATE citations SET source_id = ?, title = ?, authors = ?, year = ?, doi = ?, "
            "url = ?, accessed = ? WHERE id = ?",
            (*values, row[0]),
        )
        return row[0]
    cur = conn.execute(
        "INSERT INTO citations (source_id, title, authors, year, doi, url, accessed) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        values,
    )
    return int(cur.lastrowid)


def _write(conn: sqlite3.Connection, prepared: Prepared) -> dict[str, int]:
    stats = Counter()
    source_ids = {key: _upsert_source(conn, src) for key, src in prepared.sources.items()}
    stats["sources"] = len(source_ids)
    citation_ids = {
        key: _upsert_citation(conn, cit, source_ids[cit["source_key"]])
        for key, cit in prepared.citations.items()
    }
    stats["citations"] = len(citation_ids)

    for pol in prepared.policies:
        fields = (
            pol["title"], pol["kind"], pol["level"], pol["jurisdiction_id"], pol["enacted"],
            pol["effective"], pol["repealed"], pol["status"], pol["summary"], pol["url"],
        )
        row = conn.execute("SELECT id FROM policies WHERE slug = ?", (pol["slug"],)).fetchone()
        if row:
            policy_id = row[0]
            conn.execute(
                "UPDATE policies SET title = ?, kind = ?, level = ?, jurisdiction_id = ?, "
                "enacted_date = ?, effective_date = ?, repealed_date = ?, status = ?, "
                "summary = ?, official_url = ? WHERE id = ?",
                (*fields, policy_id),
            )
        else:
            policy_id = conn.execute(
                "INSERT INTO policies (title, kind, level, jurisdiction_id, enacted_date, "
                "effective_date, repealed_date, status, summary, official_url, slug) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (*fields, pol["slug"]),
            ).lastrowid

        # Replace the catalog-managed children. Tier B rows come from the event study,
        # which runs after this loader, so they are left alone.
        conn.execute(
            "DELETE FROM policy_effect_citations WHERE policy_effect_id IN "
            "(SELECT id FROM policy_effects WHERE policy_id = ? AND evidence_tier != 'B')",
            (policy_id,),
        )
        conn.execute("DELETE FROM policy_effects WHERE policy_id = ? AND evidence_tier != 'B'", (policy_id,))
        conn.execute("DELETE FROM policy_applicability WHERE policy_id = ?", (policy_id,))
        conn.execute("DELETE FROM policy_citations WHERE policy_id = ?", (policy_id,))

        conn.executemany(
            "INSERT INTO policy_citations (policy_id, citation_id) VALUES (?, ?)",
            [(policy_id, citation_ids[k]) for k in dict.fromkeys(pol["citations"])],
        )
        stats["policy_citations"] += len(set(pol["citations"]))

        conn.executemany(
            "INSERT INTO policy_applicability (policy_id, jurisdiction_id, start_date, end_date, notes) "
            "VALUES (?, ?, ?, ?, ?)",
            [
                (policy_id, a["jurisdiction_id"], a["start"], a["end"], a["notes"])
                for a in pol["applicability"]
            ],
        )
        stats["applicability"] += len(pol["applicability"])

        for eff in pol["effects"]:
            existing = conn.execute(
                "SELECT evidence_tier FROM policy_effects WHERE policy_id = ? AND metric_id = ?",
                (policy_id, eff["metric_id"]),
            ).fetchone()
            if existing:
                logger.warning(
                    "policy %s / metric %s already has a tier %s row; skipping the catalog's tier %s row "
                    "(policy_effects allows one row per policy and metric)",
                    pol["slug"], eff["metric"], existing[0], eff["tier"],
                )
                stats["effects_skipped"] += 1
                continue
            effect_id = conn.execute(
                "INSERT INTO policy_effects (policy_id, metric_id, mechanism, scope, expected_direction, "
                "evidence_tier, effect_estimate, effect_low, effect_high, effect_unit, method, "
                "impact_score, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    policy_id, eff["metric_id"], eff["mechanism"], eff["scope"], eff["direction"],
                    eff["tier"], eff["estimate"], eff["low"], eff["high"], eff["unit"], eff["method"],
                    eff["impact_score"], eff["confidence"],
                ),
            ).lastrowid
            conn.executemany(
                "INSERT INTO policy_effect_citations (policy_effect_id, citation_id) VALUES (?, ?)",
                [(effect_id, citation_ids[k]) for k in dict.fromkeys(eff["citations"])],
            )
            stats["effects"] += 1
        stats["policies"] += 1
    return dict(stats)


# ── Public API ──────────────────────────────────────────────────────────

def load_policies(
    target: sqlite3.Connection | str | Path, directory: Path | None = None
) -> dict[str, int]:
    """Validate the catalog and write it to the database.

    *target* is an open connection (as ``build_db`` passes) or a path to a database that
    already has the schema and seed rows. Nothing is written if validation fails; a
    :class:`CatalogError` listing every problem is raised instead. Returns row counts.
    """
    owns_connection = not isinstance(target, sqlite3.Connection)
    conn = sqlite3.connect(str(target)) if owns_connection else target
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        prepared = prepare(read_catalog(directory), conn)
        for warning in prepared.warnings:
            logger.warning("policy catalog: %s", warning)
        if prepared.errors:
            raise CatalogError(prepared.errors)
        with conn:
            stats = _write(conn, prepared)
    finally:
        if owns_connection:
            conn.close()
    logger.info(
        "loaded %d policies, %d applicability rows, %d effects, %d citations",
        stats.get("policies", 0), stats.get("applicability", 0),
        stats.get("effects", 0), stats.get("citations", 0),
    )
    return stats


def summarize(conn: sqlite3.Connection) -> str:
    """Human-readable breakdown of what the policies tables hold."""
    lines = []

    def block(title: str, query: str) -> None:
        lines.append(title)
        for label, count in conn.execute(query):
            lines.append(f"  {label:<24} {count}")

    block("Policies by kind:", "SELECT kind, count(*) FROM policies GROUP BY kind ORDER BY 2 DESC, 1")
    block("Policies by status:", "SELECT status, count(*) FROM policies GROUP BY status ORDER BY 2 DESC, 1")
    block(
        "Effects by evidence tier:",
        "SELECT evidence_tier, count(*) FROM policy_effects GROUP BY evidence_tier ORDER BY 1",
    )
    n_app = conn.execute("SELECT count(*) FROM policy_applicability").fetchone()[0]
    lines.append(f"Applicability rows: {n_app}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate and load the policy catalog.")
    parser.add_argument(
        "--db",
        help="database to load into (needs schema and seed rows). Default: a throwaway in-memory "
        "database, which makes this a pure validation run.",
    )
    parser.add_argument("--dir", type=Path, default=None, help="catalog directory (default data/policies)")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

    import schema  # noqa: PLC0415 - only the CLI needs to build a scratch database

    conn = sqlite3.connect(args.db or ":memory:")
    try:
        if not args.db:
            schema.create_tables(conn)
            seed.seed_all(conn)
        try:
            stats = load_policies(conn, args.dir)
        except CatalogError as exc:
            print(exc, file=sys.stderr)
            return 1
        print(f"OK: {stats}")
        print(summarize(conn))
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
