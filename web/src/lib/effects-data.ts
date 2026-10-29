import type Database from "better-sqlite3";
import type { EffectCitation, EffectRow, EvidenceTier } from "./state-model";

// Server-only: reads policy_effects (with citations and pre-trend p-values) for the CO2 metric.
// Shared by the state pages and the policy pages so both show the same rows in the same order.

interface EffectDbRow {
  id: number;
  policy_id: number;
  mechanism: string | null;
  scope: string | null;
  evidence_tier: EvidenceTier;
  effect_estimate: number | null;
  effect_low: number | null;
  effect_high: number | null;
  effect_unit: string | null;
  method: string | null;
  impact_score: number;
  score_basis: string;
  confidence: number | null;
  estimate_source: "catalog" | "event_study";
  outcome: string | null;
}

/**
 * Every CO2 effect row, grouped by policy id. Within a policy the published (catalog) estimate
 * comes first, then this site's own event-study rows, power sector before per capita.
 */
export function loadEffectsByPolicy(db: Database.Database): Map<number, EffectRow[]> {
  const co2 = db.prepare(`SELECT id FROM metrics WHERE slug = 'co2'`).get() as
    | { id: number }
    | undefined;
  if (!co2) throw new Error("app.db is missing the co2 metric; run the pipeline.");

  const effectRows = db
    .prepare(
      `SELECT id, policy_id, mechanism, scope, evidence_tier, effect_estimate, effect_low,
              effect_high, effect_unit, method, impact_score, score_basis, confidence,
              estimate_source, outcome
       FROM policy_effects WHERE metric_id = ?
       ORDER BY CASE estimate_source WHEN 'catalog' THEN 0 ELSE 1 END,
                CASE outcome WHEN 'co2_power' THEN 0 ELSE 1 END, outcome`,
    )
    .all(co2.id) as EffectDbRow[];

  const citationRows = db
    .prepare(
      `SELECT pec.policy_effect_id AS effect_id, c.title, c.authors, c.year, c.doi, c.url
       FROM policy_effect_citations pec JOIN citations c ON c.id = pec.citation_id
       ORDER BY c.year, c.id`,
    )
    .all() as (EffectCitation & { effect_id: number })[];
  const citationsByEffect = new Map<number, EffectCitation[]>();
  for (const c of citationRows) {
    const list = citationsByEffect.get(c.effect_id) ?? [];
    list.push({ title: c.title, authors: c.authors, year: c.year, doi: c.doi, url: c.url });
    citationsByEffect.set(c.effect_id, list);
  }

  const preTrend = new Map(
    (
      db
        .prepare(
          `SELECT policy_effect_id AS id, p_value FROM policy_effect_checks
           WHERE check_name = 'pretrend'`,
        )
        .all() as { id: number; p_value: number | null }[]
    ).map((r) => [r.id, r.p_value]),
  );

  const effectsByPolicy = new Map<number, EffectRow[]>();
  for (const e of effectRows) {
    const row: EffectRow = {
      id: e.id,
      source: e.estimate_source,
      outcome: e.outcome,
      tier: e.evidence_tier,
      estimate: e.effect_estimate,
      low: e.effect_low,
      high: e.effect_high,
      unit: e.effect_unit,
      method: e.method,
      scope: e.scope,
      mechanism: e.mechanism,
      impactScore: e.impact_score,
      scoreBasis: e.score_basis,
      confidence: e.confidence,
      preTrendP: preTrend.get(e.id) ?? null,
      citations: citationsByEffect.get(e.id) ?? [],
    };
    const list = effectsByPolicy.get(e.policy_id) ?? [];
    list.push(row);
    effectsByPolicy.set(e.policy_id, list);
  }
  return effectsByPolicy;
}
