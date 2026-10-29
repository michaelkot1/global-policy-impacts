import { cacheLife } from "next/cache";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import { getDb } from "./db";
import {
  SECTORS,
  type Co2Dataset,
  type Norm,
  type Sector,
  type SourceLink,
  type StateShape,
} from "./co2-model";

interface MetricRow {
  id: number;
  slug: string;
  name: string;
  definition: string | null;
  methodology: string | null;
  allow_total: number;
  allow_per_capita: number;
  allow_per_gdp: number;
}

/**
 * Everything the /metrics/co2 page needs, read once from data/app.db.
 * The pipeline rebuilds the file, so the result is cached for the life of a build.
 */
export async function getCo2Dataset(): Promise<Co2Dataset> {
  "use cache";
  cacheLife("max");

  const db = getDb();

  const metrics = db
    .prepare(
      `SELECT id, slug, name, definition, methodology,
              allow_total, allow_per_capita, allow_per_gdp
       FROM metrics WHERE slug IN ('co2', 'population', 'gdp')`,
    )
    .all() as MetricRow[];
  const bySlug = new Map(metrics.map((m) => [m.slug, m]));
  const co2 = bySlug.get("co2");
  const pop = bySlug.get("population");
  const gdp = bySlug.get("gdp");
  if (!co2 || !pop || !gdp) {
    throw new Error("app.db is missing the co2, population or gdp metric; run the pipeline.");
  }

  // Map shapes: us-atlas is already projected (Albers USA, 975x610), so no projection is needed.
  const topoFile = path.join(
    process.cwd(),
    "node_modules",
    "us-atlas",
    "states-albers-10m.json",
  );
  const topo = JSON.parse(await readFile(topoFile, "utf8")) as Topology<{
    states: GeometryCollection<{ name: string }>;
  }>;
  const collection = feature(topo, topo.objects.states);
  const toPath = geoPath().digits(1);
  const shapes = new Map<string, { path: string; centroid: [number, number] }>();
  for (const f of collection.features) {
    const d = toPath(f);
    if (!d) continue;
    const c = toPath.centroid(f);
    shapes.set(String(f.id), { path: d, centroid: [c[0], c[1]] });
  }

  // States only (the US row is derived by summing states so every normalization agrees).
  const stateRows = db
    .prepare(
      `SELECT id, code, name FROM jurisdictions WHERE type = 'state' ORDER BY name`,
    )
    .all() as { id: number; code: string; name: string }[];

  const years = (
    db
      .prepare(
        `SELECT DISTINCT year FROM observations
         WHERE metric_id = ? AND sector = 'total' ORDER BY year`,
      )
      .all(co2.id) as { year: number }[]
  ).map((r) => r.year);
  const yearIndex = new Map(years.map((y, i) => [y, i]));
  const stateIndex = new Map(stateRows.map((s, i) => [s.id, i]));

  const states: StateShape[] = stateRows.map((s) => {
    const shape = shapes.get(s.code);
    if (!shape) throw new Error(`No map shape for ${s.name} (FIPS ${s.code})`);
    return { code: s.code, name: s.name, path: shape.path, centroid: shape.centroid };
  });

  const blank = () =>
    stateRows.map(() => years.map(() => null as number | null));

  const emissions = Object.fromEntries(
    SECTORS.map((s) => [s, blank()]),
  ) as Record<Sector, (number | null)[][]>;
  const population = blank();
  const gdpValues = blank();

  const obs = db.prepare(
    `SELECT jurisdiction_id, year, value, sector FROM observations WHERE metric_id = ?`,
  );
  for (const r of obs.all(co2.id) as {
    jurisdiction_id: number;
    year: number;
    value: number | null;
    sector: string | null;
  }[]) {
    const si = stateIndex.get(r.jurisdiction_id);
    const yi = yearIndex.get(r.year);
    if (si === undefined || yi === undefined || !r.sector) continue;
    if ((SECTORS as readonly string[]).includes(r.sector)) {
      // 3 decimals (0.001 Mt = 1,000 t) keeps the page payload small without visible loss.
      emissions[r.sector as Sector][si][yi] =
        r.value == null ? null : Math.round(r.value * 1e3) / 1e3;
    }
  }
  for (const [metricId, target] of [
    [pop.id, population],
    [gdp.id, gdpValues],
  ] as const) {
    for (const r of obs.all(metricId) as {
      jurisdiction_id: number;
      year: number;
      value: number | null;
    }[]) {
      const si = stateIndex.get(r.jurisdiction_id);
      const yi = yearIndex.get(r.year);
      if (si === undefined || yi === undefined) continue;
      // Whole persons / whole $M: more digits are noise and cost page weight.
      target[si][yi] = r.value == null ? null : Math.round(r.value);
    }
  }

  const sources = db
    .prepare(
      `SELECT m.slug AS metric, s.name, s.publisher, s.url
       FROM metric_sources ms
       JOIN metrics m ON m.id = ms.metric_id
       JOIN sources s ON s.id = ms.source_id
       WHERE m.slug IN ('co2', 'population', 'gdp')
       ORDER BY m.id, s.id`,
    )
    .all() as SourceLink[];

  const allowed: Record<Norm, boolean> = {
    total: !!co2.allow_total,
    per_capita: !!co2.allow_per_capita,
    per_gdp: !!co2.allow_per_gdp,
  };

  return {
    years,
    states,
    emissions,
    population,
    gdp: gdpValues,
    allowed,
    metric: {
      name: co2.name,
      definition: co2.definition,
      methodology: co2.methodology,
    },
    sources,
    mapSize: { width: 975, height: 610 },
  };
}
