// Types and pure helpers for the /policies pages. No Node-only imports, so the server loaders
// and the client catalog can both use this file.

import type { EffectRow, EvidenceTier, PolicyPeriod } from "./state-model";

export const LEVEL_LABELS: Record<string, string> = {
  federal: "Federal",
  state: "State",
  interstate: "Interstate",
  international: "International",
};

/** The level filter groups state and interstate policies, as the state pages do. */
export const LEVEL_FILTERS = [
  { id: "federal", label: "Federal" },
  { id: "state", label: "State and interstate" },
  { id: "international", label: "International" },
] as const;
export type LevelFilter = (typeof LEVEL_FILTERS)[number]["id"];

export function levelFilterOf(level: string): LevelFilter {
  return level === "state" || level === "interstate" ? "state" : (level as LevelFilter);
}

/** What an event-study row measures (policy_effects.outcome). */
export const OUTCOME_LABELS: Record<string, string> = {
  co2_power: "Electric-power-sector CO₂",
  co2_per_capita: "Total CO₂ per person",
};

/** A slim effect row for the catalog (no citations or long text, to keep the page light). */
export interface CatalogEffect {
  tier: EvidenceTier;
  source: "catalog" | "event_study";
  outcome: string | null;
  estimate: number | null;
  low: number | null;
  high: number | null;
  scope: string | null;
  impactScore: number;
  /** estimate | projection | never_bound | unquantified */
  scoreBasis: string;
  confidence: number | null;
  preTrendP: number | null;
}

export interface CatalogPolicy {
  id: number;
  slug: string;
  title: string;
  kind: string;
  level: string;
  status: string;
  issuer: string;
  summary: string | null;
  enacted: string | null;
  effective: string | null;
  repealed: string | null;
  /** Calendar year the policy first applied to anyone (or, if it never did, was enacted). */
  startYear: number | null;
  /** Human-readable coverage, e.g. "All 50 states and DC", "31 states", "Never in force". */
  coverage: string;
  /** Published estimate first, then this site's own. */
  effects: CatalogEffect[];
}

export interface CoverageJurisdiction {
  name: string;
  /** Slug of the state page; null for countries. */
  slug: string | null;
}

/** Jurisdictions that share exactly the same dates of application. */
export interface CoverageGroup {
  jurisdictions: CoverageJurisdiction[];
  periods: PolicyPeriod[];
}

export interface CoverageNote {
  /** Names of the jurisdictions the note is attached to. */
  names: string[];
  text: string;
}

export interface EventPoint {
  /** Years since the policy's first full year (0), negative = before. */
  t: number;
  estimate: number;
  low: number | null;
  high: number | null;
  nStates: number;
}

export interface CheckRow {
  name: string;
  description: string | null;
  estimate: number | null;
  low: number | null;
  high: number | null;
  pValue: number | null;
  nTreated: number | null;
  nControl: number | null;
  nObs: number | null;
}

export interface EffectDetail extends EffectRow {
  eventTime: EventPoint[];
  checks: CheckRow[];
}

export interface PolicyReference {
  title: string;
  authors: string | null;
  publisher: string | null;
  year: number | null;
  doi: string | null;
  url: string | null;
  accessed: string | null;
}

export interface PolicyDetail {
  id: number;
  slug: string;
  title: string;
  kind: string;
  level: string;
  status: string;
  issuer: string;
  summary: string | null;
  officialUrl: string | null;
  enacted: string | null;
  effective: string | null;
  repealed: string | null;
  groups: CoverageGroup[];
  notes: CoverageNote[];
  /** True when any note carried the catalog's "dates are at year or month precision" boilerplate. */
  datesApproximate: boolean;
  /** Number of the 50 states and DC the policy ever applied to. */
  statesCovered: number;
  /** Total jurisdictions of type state in the database (51). */
  statesTotal: number;
  /** Last year of CO2 data, drawn as a line on the timeline. */
  dataEndYear: number;
  effects: EffectDetail[];
  /** Sources for the dates and legal text. */
  sources: PolicyReference[];
  /** Research cited by the effect estimates. */
  research: PolicyReference[];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2015-12-22" -> "Dec 22, 2015". Parsed by hand so the time zone cannot shift the day. */
export function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

export function yearOf(iso: string | null): number | null {
  if (!iso) return null;
  const y = Number(iso.slice(0, 4));
  return Number.isInteger(y) ? y : null;
}

/**
 * Names a set of jurisdictions for a label: "All 50 states and DC", "All states except Alaska
 * and Hawaii" when nearly everything is covered, otherwise the names.
 */
export function describeJurisdictions(names: string[], allStateNames: string[]): string {
  const set = new Set(names);
  const statesIn = allStateNames.filter((n) => set.has(n));
  if (statesIn.length > 0 && statesIn.length === allStateNames.length) {
    return names.length > statesIn.length ? "Every state and the United States" : "All 50 states and DC";
  }
  const missing = allStateNames.filter((n) => !set.has(n));
  if (statesIn.length >= 40 && missing.length <= 6) {
    return `All states except ${joinList(missing)}`;
  }
  return joinList([...names].sort((a, b) => a.localeCompare(b)));
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The CO2 effect row to headline: the first, which is the published one when there is one. */
export function headlineEffect<T extends { source: string }>(effects: T[]): T | undefined {
  return effects[0];
}
