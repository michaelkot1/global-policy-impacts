import { cacheLife } from "next/cache";
import { getCo2Dataset } from "./co2-data";
import { getDb } from "./db";
import { loadEffectsByPolicy } from "./effects-data";
import {
  NORMS,
  SECTORS,
  nationalValueAt,
  stateSlug,
  valueAt,
  type Norm,
  type Sector,
} from "./co2-model";
import type {
  PolicyPeriod,
  RankSeries,
  StatePageData,
  StatePolicy,
} from "./state-model";

/** Slugs of every state page ("alabama", "district-of-columbia", ...). */
export async function getStateSlugs(): Promise<string[]> {
  "use cache";
  cacheLife("max");
  const ds = await getCo2Dataset();
  return ds.states.map((s) => stateSlug(s.name));
}

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

function yearOf(iso: string | null): number | null {
  if (!iso) return null;
  const y = Number(iso.slice(0, 4));
  return Number.isInteger(y) ? y : null;
}

/** The ranking of one state among all states, per year, for one normalization. */
function rankSeries(
  ds: Awaited<ReturnType<typeof getCo2Dataset>>,
  stateIdx: number,
  norm: Norm,
): RankSeries {
  const rank: (number | null)[] = [];
  const of: number[] = [];
  for (let y = 0; y < ds.years.length; y++) {
    const mine = valueAt(ds, stateIdx, y, "total", norm);
    let count = 0;
    let above = 0;
    for (let s = 0; s < ds.states.length; s++) {
      const v = valueAt(ds, s, y, "total", norm);
      if (v == null) continue;
      count++;
      if (mine != null && v > mine) above++;
    }
    of.push(count);
    rank.push(mine == null ? null : above + 1);
  }
  return { rank, of };
}

/**
 * Everything one /states/[state] page needs: the state's emissions, rank history and the
 * policies that applied to it. Returns null for an unknown slug.
 */
export async function getStatePageData(slug: string): Promise<StatePageData | null> {
  "use cache";
  cacheLife("max");

  const ds = await getCo2Dataset();
  const stateIdx = ds.states.findIndex((s) => stateSlug(s.name) === slug);
  if (stateIdx < 0) return null;
  const state = ds.states[stateIdx];

  const db = getDb();
  const jur = db
    .prepare(`SELECT id, parent_id FROM jurisdictions WHERE type = 'state' AND code = ?`)
    .get(state.code) as { id: number; parent_id: number | null } | undefined;
  if (!jur) return null;

  const emissions = Object.fromEntries(
    SECTORS.map((s) => [s, ds.emissions[s][stateIdx]]),
  ) as Record<Sector, (number | null)[]>;

  const national = Object.fromEntries(
    NORMS.map((n) => [n, ds.years.map((_, y) => nationalValueAt(ds, y, "total", n))]),
  ) as Record<Norm, (number | null)[]>;
  const ranks = Object.fromEntries(
    NORMS.map((n) => [n, rankSeries(ds, stateIdx, n)]),
  ) as Record<Norm, RankSeries>;

  // A policy applies to a state if it names the state, or names the country the state is in
  // (federal laws and international agreements are stored once, against the country).
  const applicability = db
    .prepare(
      `SELECT policy_id, start_date, end_date, notes
       FROM policy_applicability
       WHERE jurisdiction_id = ? OR jurisdiction_id = ?
       ORDER BY policy_id, start_date`,
    )
    .all(jur.id, jur.parent_id ?? -1) as {
    policy_id: number;
    start_date: string | null;
    end_date: string | null;
    notes: string | null;
  }[];
  const periodsByPolicy = new Map<number, PolicyPeriod[]>();
  for (const a of applicability) {
    const list = periodsByPolicy.get(a.policy_id) ?? [];
    list.push({ start: a.start_date, end: a.end_date, notes: a.notes });
    periodsByPolicy.set(a.policy_id, list);
  }

  const policyRows = db
    .prepare(
      `SELECT p.id, p.slug, p.title, p.kind, p.level, p.status, p.summary, p.official_url,
              p.enacted_date, p.effective_date, p.repealed_date, j.name AS issuer
       FROM policies p JOIN jurisdictions j ON j.id = p.jurisdiction_id`,
    )
    .all() as PolicyRow[];

  const effectsByPolicy = loadEffectsByPolicy(db);

  const firstYear = ds.years[0];
  const lastYear = ds.years[ds.years.length - 1];

  const startOf = (p: PolicyRow, periods: PolicyPeriod[]) =>
    periods[0]?.start ?? p.effective_date ?? p.enacted_date ?? "";

  const applied = policyRows
    .filter((p) => periodsByPolicy.has(p.id))
    .map((p) => ({ p, periods: periodsByPolicy.get(p.id)! }))
    .sort(
      (a, b) =>
        startOf(a.p, a.periods).localeCompare(startOf(b.p, b.periods)) ||
        a.p.id - b.p.id,
    );

  const policies: StatePolicy[] = applied.map(({ p, periods }, i) => {
    const markerYears = periods
      .map((per) => yearOf(per.start ?? p.effective_date ?? p.enacted_date))
      .filter((y): y is number => y != null && y >= firstYear && y <= lastYear);
    return {
      n: i + 1,
      id: p.id,
      slug: p.slug,
      title: p.title,
      kind: p.kind,
      level: p.level,
      status: p.status,
      summary: p.summary,
      officialUrl: p.official_url,
      issuer: p.issuer,
      enacted: p.enacted_date,
      repealed: p.repealed_date,
      periods,
      markerYears: [...new Set(markerYears)],
      effects: effectsByPolicy.get(p.id) ?? [],
    };
  });

  // Catalog policies that have no applicability row for any jurisdiction (never in force).
  const everApplied = new Set(
    (
      db.prepare(`SELECT DISTINCT policy_id FROM policy_applicability`).all() as {
        policy_id: number;
      }[]
    ).map((r) => r.policy_id),
  );
  const neverApplied = policyRows
    .filter((p) => !everApplied.has(p.id))
    .map((p) => ({
      id: p.id,
      slug: p.slug,
      title: p.title,
      status: p.status,
      kind: p.kind,
      summary: p.summary,
    }));

  return {
    slug,
    code: state.code,
    name: state.name,
    years: ds.years,
    emissions,
    population: ds.population[stateIdx],
    gdp: ds.gdp[stateIdx],
    national,
    ranks,
    allowed: ds.allowed,
    policies,
    neverApplied,
  };
}
