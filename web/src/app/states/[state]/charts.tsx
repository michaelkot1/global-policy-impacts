"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import {
  NORM_UNITS,
  SECTOR_LABELS,
  formatValue,
  type Norm,
  type Sector,
} from "@/lib/co2-model";
import { ordinal, type StatePageData, type StatePolicy } from "@/lib/state-model";

/** Bottom-to-top stacking order of the five sectors. */
export const STACK: Exclude<Sector, "total">[] = [
  "electric_power",
  "industrial",
  "transportation",
  "residential",
  "commercial",
];

export const SECTOR_COLORS: Record<Exclude<Sector, "total">, string> = {
  electric_power: "#7c5cbf",
  industrial: "#8c8c8c",
  transportation: "#dc5a22",
  residential: "#2b8a9e",
  commercial: "#d9a21b",
};

interface MarkerGroup {
  year: number;
  /** Policy numbers (StatePolicy.n) whose application starts this year. */
  ns: number[];
}

function markerGroups(policies: StatePolicy[]): MarkerGroup[] {
  const byYear = new Map<number, number[]>();
  for (const p of policies) {
    for (const y of p.markerYears) {
      const list = byYear.get(y) ?? [];
      list.push(p.n);
      byYear.set(y, list);
    }
  }
  return [...byYear.entries()]
    .map(([year, ns]) => ({ year, ns }))
    .sort((a, b) => a.year - b.year);
}

/** Value of one state sector in one year, in the unit of `norm`. */
function sectorValue(
  data: StatePageData,
  sector: Sector,
  yi: number,
  norm: Norm,
): number | null {
  const mt = data.emissions[sector][yi];
  if (mt == null) return null;
  if (norm === "total") return mt;
  const denom = norm === "per_capita" ? data.population[yi] : data.gdp[yi];
  return denom ? (mt * 1e6) / denom : null;
}

function round(v: number | null) {
  return v == null ? null : Math.round(v * 1e4) / 1e4;
}

type Row = { year: number; us: number | null } & Record<Exclude<Sector, "total">, number | null>;

interface TooltipExtras {
  groups: MarkerGroup[];
  policies: StatePolicy[];
  unit: string;
  showUs: boolean;
}

function EmissionsTooltip({
  active,
  label,
  payload,
  groups,
  policies,
  unit,
  showUs,
}: TooltipContentProps & TooltipExtras) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload as Row;
  const total = STACK.reduce((s, k) => s + (row[k] ?? 0), 0);
  const starting = groups.find((g) => g.year === label)?.ns ?? [];
  return (
    <div className="max-w-64 rounded-md border border-zinc-200 bg-white p-2.5 text-xs shadow-md dark:border-zinc-700 dark:bg-zinc-900">
      <p className="font-semibold">{label}</p>
      <p className="mb-1 text-zinc-500">{unit}</p>
      <ul className="space-y-0.5">
        {[...STACK].reverse().map((k) => (
          <li key={k} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="inline-block size-2 rounded-sm"
                style={{ background: SECTOR_COLORS[k] }}
              />
              {SECTOR_LABELS[k]}
            </span>
            <span className="tabular-nums">{formatValue(row[k])}</span>
          </li>
        ))}
        <li className="flex justify-between gap-4 border-t border-zinc-200 pt-0.5 font-medium dark:border-zinc-700">
          <span>All sectors</span>
          <span className="tabular-nums">{row.electric_power == null ? "–" : formatValue(total)}</span>
        </li>
        {showUs && (
          <li className="flex justify-between gap-4 text-zinc-500">
            <span>US average</span>
            <span className="tabular-nums">{formatValue(row.us)}</span>
          </li>
        )}
      </ul>
      {starting.length > 0 && (
        <div className="mt-2 border-t border-zinc-200 pt-1.5 dark:border-zinc-700">
          <p className="text-zinc-500">Starts to apply this year</p>
          <ul className="mt-0.5 space-y-0.5">
            {starting.map((n) => (
              <li key={n}>
                <span className="font-medium tabular-nums">{n}.</span>{" "}
                {policies.find((p) => p.n === n)?.title}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

interface EmissionsChartProps {
  data: StatePageData;
  norm: Norm;
  activePolicy: number | null;
}

export function EmissionsChart({ data, norm, activePolicy }: EmissionsChartProps) {
  const unit = NORM_UNITS[norm].short;
  const showUs = norm !== "total";
  const rows: Row[] = data.years.map((year, yi) => ({
    year,
    us: round(data.national[norm][yi]),
    electric_power: round(sectorValue(data, "electric_power", yi, norm)),
    industrial: round(sectorValue(data, "industrial", yi, norm)),
    transportation: round(sectorValue(data, "transportation", yi, norm)),
    residential: round(sectorValue(data, "residential", yi, norm)),
    commercial: round(sectorValue(data, "commercial", yi, norm)),
  }));
  const groups = markerGroups(data.policies);
  const lastYear = data.years[data.years.length - 1];
  const active = data.policies.find((p) => p.n === activePolicy) ?? null;

  // Span(s) over which the highlighted policy applies, clipped to the data range.
  const spans = (active?.periods ?? [])
    .map((per) => {
      const s = Number((per.start ?? active?.enacted ?? "").slice(0, 4));
      const e = per.end ? Number(per.end.slice(0, 4)) : lastYear;
      return { x1: Math.max(s, data.years[0]), x2: Math.min(e, lastYear) };
    })
    .filter((s) => Number.isFinite(s.x1) && s.x1 <= s.x2);

  const first = data.years.findIndex((_, yi) => rows[yi].electric_power != null);
  const summary = `Stacked area chart of ${data.name} energy-related CO2 emissions by sector, ${unit}, ${
    data.years[first] ?? data.years[0]
  } to ${lastYear}, with the years policies began to apply marked.`;

  return (
    <div className="h-80 text-zinc-500 sm:h-96" role="img" aria-label={summary}>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 720, height: 360 }}>
        <ComposedChart data={rows} margin={{ top: 22, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="currentColor" strokeOpacity={0.15} vertical={false} />
          <XAxis
            dataKey="year"
            type="number"
            domain={[data.years[0], lastYear]}
            ticks={data.years.filter((y) => y % 5 === 0)}
            tick={{ fill: "currentColor", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            width={48}
            tick={{ fill: "currentColor", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => formatValue(v)}
          />
          <Tooltip
            content={(p) => (
              <EmissionsTooltip
                {...p}
                groups={groups}
                policies={data.policies}
                unit={unit}
                showUs={showUs}
              />
            )}
          />
          {spans.map((s, i) => (
            <ReferenceArea
              key={i}
              x1={s.x1}
              x2={s.x2}
              fill="#dc5a22"
              fillOpacity={0.1}
              stroke="none"
              ifOverflow="hidden"
            />
          ))}
          {STACK.map((k) => (
            <Area
              key={k}
              type="monotone"
              dataKey={k}
              name={SECTOR_LABELS[k]}
              stackId="sectors"
              stroke={SECTOR_COLORS[k]}
              fill={SECTOR_COLORS[k]}
              fillOpacity={0.75}
              strokeWidth={0.5}
              isAnimationActive={false}
              connectNulls={false}
            />
          ))}
          {showUs && (
            <Line
              type="monotone"
              dataKey="us"
              name="US average"
              stroke="currentColor"
              strokeDasharray="5 3"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
              connectNulls={false}
            />
          )}
          {groups.map((g) => {
            const hit = activePolicy != null && g.ns.includes(activePolicy);
            return (
              <ReferenceLine
                key={g.year}
                x={g.year}
                stroke={hit ? "#dc5a22" : "currentColor"}
                strokeOpacity={hit ? 1 : 0.45}
                strokeDasharray={hit ? undefined : "2 3"}
                strokeWidth={hit ? 2 : 1}
                ifOverflow="hidden"
                label={{
                  value: g.ns.length > 3 ? `${g.ns[0]}–${g.ns[g.ns.length - 1]}` : g.ns.join("·"),
                  position: "top",
                  fontSize: 10,
                  fill: hit ? "#dc5a22" : "currentColor",
                  fontWeight: hit ? 700 : 400,
                }}
              />
            );
          })}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function RankChart({
  data,
  norm,
}: {
  data: StatePageData;
  norm: Norm;
}) {
  const { rank, of } = data.ranks[norm];
  const rows = data.years.map((year, yi) => ({ year, rank: rank[yi], of: of[yi] }));
  const known = rank.filter((r): r is number => r != null);
  const maxOf = Math.max(...of);
  const lo = Math.max(1, Math.min(...known) - 2);
  const hi = Math.min(maxOf, Math.max(...known) + 2);
  const lastYear = data.years[data.years.length - 1];
  const step = Math.max(1, Math.ceil((hi - lo) / 4));
  const rankTicks: number[] = [];
  for (let t = lo; t <= hi; t += step) rankTicks.push(t);
  const summary = `Line chart of ${data.name}'s rank among states by ${NORM_UNITS[norm].long}, 1 being highest, ${
    data.years[rank.findIndex((r) => r != null)]
  } to ${lastYear}.`;

  return (
    <div className="h-56 text-zinc-500" role="img" aria-label={summary}>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 720, height: 224 }}>
        <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="currentColor" strokeOpacity={0.15} vertical={false} />
          <XAxis
            dataKey="year"
            type="number"
            domain={[data.years[0], lastYear]}
            ticks={data.years.filter((y) => y % 5 === 0)}
            tick={{ fill: "currentColor", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            width={48}
            reversed
            domain={[lo, hi]}
            ticks={rankTicks}
            interval={0}
            allowDecimals={false}
            tick={{ fill: "currentColor", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => ordinal(v)}
          />
          <Tooltip
            formatter={(v, _n, item) => [
              v == null ? "–" : `${ordinal(Number(v))} of ${(item.payload as { of: number }).of}`,
              "Rank (1 = highest)",
            ]}
            labelFormatter={(l) => String(l)}
            contentStyle={{ fontSize: 12 }}
          />
          <Line
            type="linear"
            dataKey="rank"
            stroke="#dc5a22"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
