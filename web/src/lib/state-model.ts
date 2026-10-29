// Types shared by the /states/[state] loader (server) and its charts (client).
// No Node-only imports.

import type { Norm, Sector } from "./co2-model";

export type EvidenceTier = "A" | "B" | "C" | "D";

export const TIER_LABELS: Record<EvidenceTier, { name: string; blurb: string }> = {
  A: { name: "Causal", blurb: "Peer-reviewed quasi-experimental evidence" },
  B: { name: "Estimated", blurb: "This site's own event-study estimate" },
  C: { name: "Associated", blurb: "Correlation or descriptive trend only" },
  D: { name: "Potential", blurb: "Plausible mechanism, no measured effect" },
};

export interface EffectCitation {
  title: string;
  authors: string | null;
  year: number | null;
  doi: string | null;
  url: string | null;
}

export interface EffectRow {
  id: number;
  /** "catalog" = published estimate entered by hand; "event_study" = this site's own. */
  source: "catalog" | "event_study";
  outcome: string | null;
  tier: EvidenceTier;
  /** Percent change; null when the effect has not been quantified. */
  estimate: number | null;
  low: number | null;
  high: number | null;
  unit: string | null;
  method: string | null;
  scope: string | null;
  mechanism: string | null;
  impactScore: number;
  /** estimate | projection | never_bound | unquantified */
  scoreBasis: string;
  confidence: number | null;
  /** Joint pre-trend test p-value (event-study rows only). */
  preTrendP: number | null;
  citations: EffectCitation[];
}

export interface PolicyPeriod {
  start: string | null; // ISO date
  end: string | null; // ISO date, null = still in effect
  notes: string | null;
}

export interface StatePolicy {
  /** 1-based position in the list; the same number labels its marker on the chart. */
  n: number;
  id: number;
  slug: string;
  title: string;
  kind: string;
  level: string;
  status: string;
  summary: string | null;
  officialUrl: string | null;
  issuer: string;
  enacted: string | null;
  repealed: string | null;
  periods: PolicyPeriod[];
  /** Years inside the data range in which a period of application starts. */
  markerYears: number[];
  /** Published estimate first, then this site's own. */
  effects: EffectRow[];
}

export interface RankSeries {
  /** rank[yearIndex]; 1 = highest. null when the state has no value that year. */
  rank: (number | null)[];
  /** Number of states ranked in each year. */
  of: number[];
}

export interface StatePageData {
  slug: string;
  code: string; // FIPS
  name: string;
  years: number[];
  /** Sector emissions of this state, Mt CO2, [sector][yearIndex]. */
  emissions: Record<Sector, (number | null)[]>;
  population: (number | null)[];
  gdp: (number | null)[];
  /** United States (sum of states) for the "total" sector, by normalization. */
  national: Record<Norm, (number | null)[]>;
  ranks: Record<Norm, RankSeries>;
  allowed: Record<Norm, boolean>;
  policies: StatePolicy[];
  /** Policies in the catalog that never legally applied to any state. */
  neverApplied: {
    id: number;
    slug: string;
    title: string;
    status: string;
    kind: string;
    summary: string | null;
  }[];
}

export const KIND_LABELS: Record<string, string> = {
  federal_law: "Federal law",
  executive_order: "Executive order",
  regulation: "Regulation",
  state_law: "State law",
  interstate_program: "Interstate program",
  international_agreement: "International agreement",
};

/** 1 -> "1st", 22 -> "22nd", 11 -> "11th". */
export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}
