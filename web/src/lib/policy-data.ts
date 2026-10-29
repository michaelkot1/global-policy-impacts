import { cacheLife } from "next/cache";
import { getDb } from "./db";
import { stateSlug } from "./co2-model";
import { loadEffectsByPolicy } from "./effects-data";
import {
  yearOf,
  type CatalogPolicy,
  type CheckRow,
  type CoverageGroup,
  type CoverageNote,
  type EffectDetail,
  type EventPoint,
  type PolicyDetail,
  type PolicyReference,
} from "./policy-model";
import type { PolicyPeriod } from "./state-model";

// Server-only loaders for /policies and /policies/[slug]. The pipeline rebuilds data/app.db, so
// results are cached for the life of a build, as for the other pages.

interface PolicyRow {
  id: number;
  slug: string;
  title: string;
  kind: string;
  level: string;
  status: string;
  summary: string | null;
  official_url: string | null;
  enacted_date: string | null;
  effective_date: string | null;
  repealed_date: string | null;
  issuer: string;
}

interface ApplicabilityRow {
  policy_id: number;
  jurisdiction_id: number;
  name: string;
  type: string;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
}

const POLICY_SELECT = `SELECT p.id, p.slug, p.title, p.kind, p.level, p.status, p.summary,
       p.official_url, p.enacted_date, p.effective_date, p.repealed_date, j.name AS issuer
  FROM policies p JOIN jurisdictions j ON j.id = p.jurisdiction_id`;

const APPLICABILITY_SELECT = `SELECT a.policy_id, a.jurisdiction_id, j.name, j.type,
       a.start_date, a.end_date, a.notes
  FROM policy_applicability a JOIN jurisdictions j ON j.id = a.jurisdiction_id`;

/** Sentence the catalog loader appends to applicability notes; shown once, not per state. */
const PRECISION_BOILERPLATE =
  /\s*Dates are given at year or month precision in the catalog; start dates are set to the first day and end dates to the last day of the period\.?/;

function stateCount(db: ReturnType<typeof getDb>): number {
  return (
    db.prepare(`SELECT COUNT(*) AS n FROM jurisdictions WHERE type = 'state'`).get() as {
      n: number;
    }
  ).n;
}

function coverageText(rows: ApplicabilityRow[], statesTotal: number): string {
  if (rows.length === 0) return "Never in force";
  const states = new Set(rows.filter((r) => r.type === "state").map((r) => r.jurisdiction_id));
  if (states.size >= statesTotal) return "All 50 states and DC";
  if (states.size === 0) {
    const names = [...new Set(rows.map((r) => r.name))];
    return names.length === 1 ? names[0] : `${names.length} jurisdictions`;
  }
  // "Over time": states that joined, left or returned count once.
  return states.size === 1
    ? rows.find((r) => r.type === "state")!.name
    : `${states.size} states over time`;
}

export async function getPolicySlugs(): Promise<string[]> {
  "use cache";
  cacheLife("max");
  const rows = getDb().prepare(`SELECT slug FROM policies ORDER BY id`).all() as {
    slug: string;
  }[];
  return rows.map((r) => r.slug);
}

/** Every policy with its dates, coverage and CO2 evidence, for the catalog. */
export async function getPolicyCatalog(): Promise<CatalogPolicy[]> {
  "use cache";
  cacheLife("max");

  const db = getDb();
  const policies = db.prepare(`${POLICY_SELECT} ORDER BY p.id`).all() as PolicyRow[];
  const applicability = db.prepare(APPLICABILITY_SELECT).all() as ApplicabilityRow[];
  const byPolicy = new Map<number, ApplicabilityRow[]>();
  for (const a of applicability) {
    const list = byPolicy.get(a.policy_id) ?? [];
    list.push(a);
    byPolicy.set(a.policy_id, list);
  }
  const effects = loadEffectsByPolicy(db);
  const statesTotal = stateCount(db);

  return policies.map((p) => {
    const rows = byPolicy.get(p.id) ?? [];
    const starts = rows
      .map((r) => r.start_date)
      .filter((d): d is string => !!d)
      .sort();
    const start = starts[0] ?? p.effective_date ?? p.enacted_date;
    return {
      id: p.id,
      slug: p.slug,
      title: p.title,
      kind: p.kind,
      level: p.level,
      status: p.status,
      issuer: p.issuer,
      summary: p.summary,
      enacted: p.enacted_date,
      effective: p.effective_date,
      repealed: p.repealed_date,
      startYear: yearOf(start),
      coverage: coverageText(rows, statesTotal),
      effects: (effects.get(p.id) ?? []).map((e) => ({
        tier: e.tier,
        source: e.source,
        outcome: e.outcome,
        estimate: e.estimate,
        low: e.low,
        high: e.high,
        scope: e.scope,
        impactScore: e.impactScore,
        scoreBasis: e.scoreBasis,
        confidence: e.confidence,
        preTrendP: e.preTrendP,
      })),
    };
  });
}

function periodKey(periods: PolicyPeriod[]): string {
  return periods.map((p) => `${p.start ?? ""}|${p.end ?? ""}`).join(";");
}

/** One policy with everything its detail page shows. Null for an unknown slug. */
export async function getPolicyDetail(slug: string): Promise<PolicyDetail | null> {
  "use cache";
  cacheLife("max");

  const db = getDb();
  const p = db.prepare(`${POLICY_SELECT} WHERE p.slug = ?`).get(slug) as PolicyRow | undefined;
  if (!p) return null;

  const rows = db
    .prepare(`${APPLICABILITY_SELECT} WHERE a.policy_id = ? ORDER BY a.start_date, j.name`)
    .all(p.id) as ApplicabilityRow[];

  // Jurisdictions with the same dates share one row of the timeline.
  const periodsByJur = new Map<
    number,
    { name: string; type: string; periods: PolicyPeriod[] }
  >();
  for (const r of rows) {
    const entry = periodsByJur.get(r.jurisdiction_id) ?? {
      name: r.name,
      type: r.type,
      periods: [],
    };
    entry.periods.push({ start: r.start_date, end: r.end_date, notes: null });
    periodsByJur.set(r.jurisdiction_id, entry);
  }
  const groupMap = new Map<string, CoverageGroup>();
  for (const j of periodsByJur.values()) {
    const key = periodKey(j.periods);
    const group = groupMap.get(key) ?? { jurisdictions: [], periods: j.periods };
    group.jurisdictions.push({
      name: j.name,
      slug: j.type === "state" ? stateSlug(j.name) : null,
    });
    groupMap.set(key, group);
  }
  const groups = [...groupMap.values()]
    .map((g) => ({
      ...g,
      jurisdictions: g.jurisdictions.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort(
      (a, b) =>
        (a.periods[0].start ?? "").localeCompare(b.periods[0].start ?? "") ||
        a.jurisdictions[0].name.localeCompare(b.jurisdictions[0].name),
    );

  // Notes, merged where several jurisdictions carry the same text.
  let datesApproximate = false;
  const noteMap = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.notes) continue;
    if (PRECISION_BOILERPLATE.test(r.notes)) datesApproximate = true;
    const text = r.notes.replace(PRECISION_BOILERPLATE, "").trim();
    if (!text) continue;
    const names = noteMap.get(text) ?? new Set<string>();
    names.add(r.name);
    noteMap.set(text, names);
  }
  const notes: CoverageNote[] = [...noteMap.entries()].map(([text, names]) => ({
    text,
    names: [...names],
  }));

  const statesCovered = new Set(
    rows.filter((r) => r.type === "state").map((r) => r.jurisdiction_id),
  ).size;

  // Evidence: the rows the state pages show, plus the event-study detail behind tier B rows.
  const base = loadEffectsByPolicy(db).get(p.id) ?? [];
  const ids = base.map((e) => e.id);
  const eventTime = new Map<number, EventPoint[]>();
  const checks = new Map<number, CheckRow[]>();
  if (ids.length > 0) {
    const marks = ids.map(() => "?").join(",");
    for (const r of db
      .prepare(
        `SELECT policy_effect_id AS id, event_time, estimate, low, high, n_states
         FROM policy_effect_event_time WHERE policy_effect_id IN (${marks})
         ORDER BY policy_effect_id, event_time`,
      )
      .all(...ids) as {
      id: number;
      event_time: number;
      estimate: number;
      low: number | null;
      high: number | null;
      n_states: number;
    }[]) {
      const list = eventTime.get(r.id) ?? [];
      list.push({
        t: r.event_time,
        estimate: r.estimate,
        low: r.low,
        high: r.high,
        nStates: r.n_states,
      });
      eventTime.set(r.id, list);
    }
    for (const r of db
      .prepare(
        `SELECT policy_effect_id AS id, check_name, description, estimate, low, high, p_value,
                n_treated, n_control, n_obs
         FROM policy_effect_checks WHERE policy_effect_id IN (${marks})
         ORDER BY policy_effect_id, id`,
      )
      .all(...ids) as {
      id: number;
      check_name: string;
      description: string | null;
      estimate: number | null;
      low: number | null;
      high: number | null;
      p_value: number | null;
      n_treated: number | null;
      n_control: number | null;
      n_obs: number | null;
    }[]) {
      const list = checks.get(r.id) ?? [];
      list.push({
        name: r.check_name,
        description: r.description,
        estimate: r.estimate,
        low: r.low,
        high: r.high,
        pValue: r.p_value,
        nTreated: r.n_treated,
        nControl: r.n_control,
        nObs: r.n_obs,
      });
      checks.set(r.id, list);
    }
  }
  const effects: EffectDetail[] = base.map((e) => ({
    ...e,
    eventTime: eventTime.get(e.id) ?? [],
    checks: checks.get(e.id) ?? [],
  }));

  // Sources of the dates and legal text, then the research behind the effect estimates.
  const sources = db
    .prepare(
      `SELECT c.title, c.authors, c.year, c.doi, c.url, c.accessed, s.publisher
       FROM policy_citations pc
       JOIN citations c ON c.id = pc.citation_id
       LEFT JOIN sources s ON s.id = c.source_id
       WHERE pc.policy_id = ? ORDER BY c.id`,
    )
    .all(p.id) as (Omit<PolicyReference, "publisher"> & { publisher: string | null })[];
  const research = new Map<string, PolicyReference>();
  for (const e of effects) {
    for (const c of e.citations) {
      const key = c.doi ?? c.url ?? c.title;
      if (!research.has(key)) {
        research.set(key, {
          title: c.title,
          authors: c.authors,
          publisher: null,
          year: c.year,
          doi: c.doi,
          url: c.url,
          accessed: null,
        });
      }
    }
  }

  const dataEndYear = (
    db
      .prepare(
        `SELECT MAX(o.year) AS y FROM observations o JOIN metrics m ON m.id = o.metric_id
         WHERE m.slug = 'co2'`,
      )
      .get() as { y: number }
  ).y;

  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    kind: p.kind,
    level: p.level,
    status: p.status,
    issuer: p.issuer,
    summary: p.summary,
    officialUrl: p.official_url,
    enacted: p.enacted_date,
    effective: p.effective_date,
    repealed: p.repealed_date,
    groups,
    notes,
    datesApproximate,
    statesCovered,
    statesTotal: stateCount(db),
    dataEndYear,
    effects,
    sources,
    research: [...research.values()],
  };
}

/** Names of all 50 states and DC, for labelling coverage ("All states except ..."). */
export async function getAllStateNames(): Promise<string[]> {
  "use cache";
  cacheLife("max");
  return (
    getDb()
      .prepare(`SELECT name FROM jurisdictions WHERE type = 'state' ORDER BY name`)
      .all() as { name: string }[]
  ).map((r) => r.name);
}
