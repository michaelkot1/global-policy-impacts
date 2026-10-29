import { cacheLife } from "next/cache";
import { getDb } from "./db";
import type { EvidenceTier } from "./state-model";

// Server-only: the numbers and source lists the /methodology page quotes, read live from
// data/app.db so the page cannot drift from the data.

export interface MethodologyMetric {
  slug: string;
  name: string;
  unit: string;
  definition: string | null;
  methodology: string | null;
  higherIsBetter: boolean;
  normalizations: string[];
  sources: { name: string; publisher: string | null; url: string | null }[];
}

export interface MethodologySource {
  name: string;
  publisher: string | null;
  url: string | null;
  description: string | null;
}

export interface MethodologyData {
  metrics: MethodologyMetric[];
  /** Sources behind the policy records and evidence (not metric data). */
  policySources: MethodologySource[];
  firstYear: number;
  lastYear: number;
  stateCount: number;
  policyCount: number;
  /** Number of policies that have at least one CO2 effect row at each tier. */
  policiesByTier: Record<EvidenceTier, number>;
  /** Policies whose CO2 effect has a number (a measured estimate or a modelled projection). */
  quantifiedCount: number;
  unquantifiedCount: number;
  neverBoundCount: number;
  ownEstimates: {
    count: number;
    /** How many of them reject parallel pre-trends at the 10% level. */
    preTrendRejected: number;
    policies: string[];
  };
}

export async function getMethodologyData(): Promise<MethodologyData> {
  "use cache";
  cacheLife("max");
  const db = getDb();

  const metricRows = db
    .prepare(
      `SELECT id, slug, name, unit, definition, methodology, higher_is_better,
              allow_total, allow_per_capita, allow_per_gdp
       FROM metrics ORDER BY id`,
    )
    .all() as {
    id: number;
    slug: string;
    name: string;
    unit: string;
    definition: string | null;
    methodology: string | null;
    higher_is_better: number;
    allow_total: number;
    allow_per_capita: number;
    allow_per_gdp: number;
  }[];
  const sourceRows = db
    .prepare(
      `SELECT ms.metric_id, s.name, s.publisher, s.url
       FROM metric_sources ms JOIN sources s ON s.id = ms.source_id ORDER BY s.id`,
    )
    .all() as { metric_id: number; name: string; publisher: string | null; url: string | null }[];

  const metrics: MethodologyMetric[] = metricRows.map((m) => ({
    slug: m.slug,
    name: m.name,
    unit: m.unit,
    definition: m.definition,
    methodology: m.methodology,
    higherIsBetter: !!m.higher_is_better,
    normalizations: [
      m.allow_total && "total",
      m.allow_per_capita && "per capita",
      m.allow_per_gdp && "per GDP",
    ].filter((x): x is string => !!x),
    sources: sourceRows
      .filter((s) => s.metric_id === m.id)
      .map(({ name, publisher, url }) => ({ name, publisher, url })),
  }));

  const policySources = db
    .prepare(
      `SELECT name, publisher, url, description FROM sources
       WHERE id NOT IN (SELECT source_id FROM metric_sources) ORDER BY id`,
    )
    .all() as MethodologySource[];

  const co2 = db.prepare(`SELECT id FROM metrics WHERE slug = 'co2'`).get() as { id: number };
  const years = db
    .prepare(
      `SELECT MIN(year) AS first, MAX(year) AS last FROM observations
       WHERE metric_id = ? AND sector = 'total'`,
    )
    .get(co2.id) as { first: number; last: number };
  const stateCount = (
    db.prepare(`SELECT COUNT(*) AS n FROM jurisdictions WHERE type = 'state'`).get() as {
      n: number;
    }
  ).n;
  const policyCount = (db.prepare(`SELECT COUNT(*) AS n FROM policies`).get() as { n: number }).n;

  const policiesByTier = { A: 0, B: 0, C: 0, D: 0 } as Record<EvidenceTier, number>;
  for (const r of db
    .prepare(
      `SELECT evidence_tier AS tier, COUNT(DISTINCT policy_id) AS n
       FROM policy_effects WHERE metric_id = ? GROUP BY evidence_tier`,
    )
    .all(co2.id) as { tier: EvidenceTier; n: number }[]) {
    policiesByTier[r.tier] = r.n;
  }

  const countPolicies = (where: string) =>
    (
      db
        .prepare(
          `SELECT COUNT(DISTINCT policy_id) AS n FROM policy_effects
           WHERE metric_id = ? AND ${where}`,
        )
        .get(co2.id) as { n: number }
    ).n;

  const own = db
    .prepare(
      `SELECT pe.id, p.title, c.p_value
       FROM policy_effects pe
       JOIN policies p ON p.id = pe.policy_id
       LEFT JOIN policy_effect_checks c
         ON c.policy_effect_id = pe.id AND c.check_name = 'pretrend'
       WHERE pe.metric_id = ? AND pe.estimate_source = 'event_study'`,
    )
    .all(co2.id) as { id: number; title: string; p_value: number | null }[];

  return {
    metrics,
    policySources,
    firstYear: years.first,
    lastYear: years.last,
    stateCount,
    policyCount,
    policiesByTier,
    quantifiedCount: countPolicies(`score_basis IN ('estimate', 'projection')`),
    unquantifiedCount: countPolicies(`score_basis = 'unquantified'`),
    neverBoundCount: countPolicies(`score_basis = 'never_bound'`),
    ownEstimates: {
      count: own.length,
      preTrendRejected: own.filter((r) => r.p_value != null && r.p_value < 0.1).length,
      policies: [...new Set(own.map((r) => r.title))],
    },
  };
}
