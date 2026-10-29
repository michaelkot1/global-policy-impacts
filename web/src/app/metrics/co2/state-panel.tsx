"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import Link from "next/link";
import { formatPercentChange, formatValue, stateSlug } from "@/lib/co2-model";

interface Props {
  name: string;
  year: number;
  unit: string;
  value: number | null;
  rank: number | null;
  rankedCount: number;
  /** Share of the national total, only for the "total" normalization. */
  share: number | null;
  vs2005: number | null; // fractional change
  series: { year: number; value: number | null }[];
  onClear: () => void;
}

export function StatePanel({
  name,
  year,
  unit,
  value,
  rank,
  rankedCount,
  share,
  vs2005,
  series,
  onClear,
}: Props) {
  return (
    <section
      aria-label={`${name} details`}
      className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">{name}</h3>
          <p className="mt-0.5 text-sm text-zinc-500">
            {year}: <span className="tabular-nums text-foreground">{formatValue(value)}</span>{" "}
            {unit}
            {rank != null && (
              <>
                {" "}
                · rank {rank} of {rankedCount}
              </>
            )}
            {share != null && <> · {formatValue(share * 100)}% of the US</>}
            {vs2005 != null && year > 2005 && (
              <> · {formatPercentChange(1 + vs2005, 1)} since 2005</>
            )}
          </p>
        </div>
        <Link
          href={`/states/${stateSlug(name)}`}
          className="ml-auto rounded px-2 py-1 text-xs font-medium underline underline-offset-2 hover:bg-zinc-100 dark:hover:bg-zinc-900"
        >
          Policies and rank history
        </Link>
        <button
          type="button"
          onClick={onClear}
          className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-foreground dark:hover:bg-zinc-900"
        >
          Clear
        </button>
      </div>

      <div className="mt-3 h-36 text-zinc-500" aria-hidden>
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 360, height: 144 }}>
          <LineChart data={series} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="currentColor" strokeOpacity={0.15} vertical={false} />
            <XAxis
              dataKey="year"
              type="number"
              domain={["dataMin", "dataMax"]}
              tick={{ fill: "currentColor", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              width={44}
              tick={{ fill: "currentColor", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => formatValue(v)}
            />
            <Tooltip
              formatter={(v) => [`${formatValue(typeof v === "number" ? v : null)} ${unit}`, name]}
              labelFormatter={(l) => String(l)}
              contentStyle={{ fontSize: 12 }}
            />
            <ReferenceLine x={year} stroke="currentColor" strokeDasharray="3 3" />
            <Line
              type="monotone"
              dataKey="value"
              stroke="#dc5a22"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
