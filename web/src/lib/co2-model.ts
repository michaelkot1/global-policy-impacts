// Types and pure calculations for the CO2 rankings page. No Node-only imports,
// so both the server loader and the client explorer can use this file.

export const SECTORS = [
  "total",
  "residential",
  "commercial",
  "industrial",
  "transportation",
  "electric_power",
] as const;
export type Sector = (typeof SECTORS)[number];

export const SECTOR_LABELS: Record<Sector, string> = {
  total: "All sectors",
  residential: "Residential",
  commercial: "Commercial",
  industrial: "Industrial",
  transportation: "Transportation",
  electric_power: "Electric power",
};

export const NORMS = ["total", "per_capita", "per_gdp"] as const;
export type Norm = (typeof NORMS)[number];

export const NORM_LABELS: Record<Norm, string> = {
  total: "Total",
  per_capita: "Per capita",
  per_gdp: "Per GDP",
};

export const NORM_UNITS: Record<Norm, { short: string; long: string }> = {
  total: { short: "Mt CO₂", long: "million metric tons CO₂" },
  per_capita: { short: "t CO₂ / person", long: "metric tons CO₂ per person" },
  per_gdp: {
    short: "t CO₂ / $M GDP",
    long: "metric tons CO₂ per million dollars of GDP",
  },
};

/** URL slug of a state page, e.g. "District of Columbia" -> "district-of-columbia". */
export function stateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export interface StateShape {
  code: string; // FIPS, e.g. "06"
  name: string;
  path: string; // SVG path in the 975x610 Albers USA frame
  centroid: [number, number];
}

export interface SourceLink {
  metric: string; // metric slug the source belongs to
  name: string;
  publisher: string | null;
  url: string | null;
}

export interface Co2Dataset {
  years: number[];
  states: StateShape[];
  /** emissions[sector][stateIndex][yearIndex], million metric tons; null if missing. */
  emissions: Record<Sector, (number | null)[][]>;
  /** population[stateIndex][yearIndex], persons. */
  population: (number | null)[][];
  /** gdp[stateIndex][yearIndex], millions of current dollars (BEA starts in 1997). */
  gdp: (number | null)[][];
  allowed: Record<Norm, boolean>;
  metric: { name: string; definition: string | null; methodology: string | null };
  sources: SourceLink[];
  mapSize: { width: number; height: number };
}

/** First and last year for which a normalization can be computed. */
export function yearRange(ds: Co2Dataset, norm: Norm): [number, number] {
  const last = ds.years[ds.years.length - 1];
  if (norm !== "per_gdp") return [ds.years[0], last];
  const gdpYears = ds.years.filter((_, yi) =>
    ds.gdp.some((row) => row[yi] != null),
  );
  return [gdpYears[0] ?? ds.years[0], last];
}

/** Value of one state in one year, in the unit of `norm`; null if undefined. */
export function valueAt(
  ds: Co2Dataset,
  stateIdx: number,
  yearIdx: number,
  sector: Sector,
  norm: Norm,
): number | null {
  const mt = ds.emissions[sector][stateIdx][yearIdx];
  if (mt == null) return null;
  if (norm === "total") return mt;
  if (norm === "per_capita") {
    const pop = ds.population[stateIdx][yearIdx];
    return pop ? (mt * 1e6) / pop : null;
  }
  const gdp = ds.gdp[stateIdx][yearIdx];
  return gdp ? (mt * 1e6) / gdp : null; // Mt*1e6 t / (GDP in $M)
}

/** The whole United States (sum of states) in one year; null if any input is missing. */
export function nationalValueAt(
  ds: Co2Dataset,
  yearIdx: number,
  sector: Sector,
  norm: Norm,
): number | null {
  let mt = 0;
  let denom = 0;
  for (let s = 0; s < ds.states.length; s++) {
    const e = ds.emissions[sector][s][yearIdx];
    if (e == null) return null;
    mt += e;
    if (norm === "per_capita") {
      const p = ds.population[s][yearIdx];
      if (p == null) return null;
      denom += p;
    } else if (norm === "per_gdp") {
      const g = ds.gdp[s][yearIdx];
      if (g == null) return null;
      denom += g;
    }
  }
  if (norm === "total") return mt;
  return denom ? (mt * 1e6) / denom : null;
}

/**
 * Class breaks (quantiles of every state-year value) so a colour means the same
 * thing in every year and the map can be compared as the slider moves.
 */
export function classBreaks(
  ds: Co2Dataset,
  sector: Sector,
  norm: Norm,
  classes: number,
): number[] {
  const values: number[] = [];
  for (let s = 0; s < ds.states.length; s++) {
    for (let y = 0; y < ds.years.length; y++) {
      const v = valueAt(ds, s, y, sector, norm);
      if (v != null && v > 0) values.push(v);
    }
  }
  values.sort((a, b) => a - b);
  if (values.length === 0) return [];
  const breaks: number[] = [];
  for (let k = 1; k < classes; k++) {
    const q = values[Math.min(values.length - 1, Math.floor((k / classes) * values.length))];
    if (breaks.length === 0 || q > breaks[breaks.length - 1]) breaks.push(q);
  }
  return breaks;
}

/** Index of the class a value falls in, given ascending breaks. */
export function classOf(value: number, breaks: number[]): number {
  let i = 0;
  while (i < breaks.length && value >= breaks[i]) i++;
  return i;
}

const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export function formatValue(v: number | null): string {
  if (v == null) return "–";
  const a = Math.abs(v);
  if (a >= 100) return nf0.format(v);
  if (a >= 10) return nf1.format(v);
  return nf2.format(v);
}

export function formatPercentChange(now: number | null, base: number | null): string {
  if (now == null || base == null || base === 0) return "–";
  const pct = Math.round(((now - base) / base) * 100);
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
  return `${sign}${nf0.format(Math.abs(pct))}%`;
}
