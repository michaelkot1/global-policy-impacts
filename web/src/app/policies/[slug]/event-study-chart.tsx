"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import { signed } from "@/components/evidence";
import type { EventPoint } from "@/lib/policy-model";

interface Row {
  t: number;
  estimate: number;
  band: [number, number] | null;
  low: number | null;
  high: number | null;
  nStates: number;
}

function EventTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload as Row;
  return (
    <div className="rounded-md border border-zinc-200 bg-white p-2.5 text-xs shadow-md dark:border-zinc-700 dark:bg-zinc-900">
      <p className="font-semibold">
        {r.t < 0
          ? `${-r.t} year${r.t === -1 ? "" : "s"} before the policy`
          : r.t === 0
            ? "First full year of the policy"
            : `${r.t} year${r.t === 1 ? "" : "s"} after the first full year`}
      </p>
      <p className="mt-1 tabular-nums">
        {signed(r.estimate)}%
        {r.low != null && r.high != null && (
          <span className="text-zinc-500">
            {" "}
            (95% interval {signed(r.low)}% to {signed(r.high)}%)
          </span>
        )}
      </p>
      <p className="text-zinc-500">{r.nStates} adopting states contribute</p>
    </div>
  );
}

/**
 * Event-study coefficients: the estimated percent change in CO2 relative to comparison states,
 * by years since the policy began. Points before 0 should sit near zero if adopting and
 * comparison states were on parallel paths.
 */
export function EventStudyChart({
  points,
  label,
}: {
  points: EventPoint[];
  label: string;
}) {
  const rows: Row[] = points.map((p) => ({
    t: p.t,
    estimate: p.estimate,
    band: p.low != null && p.high != null ? [p.low, p.high] : null,
    low: p.low,
    high: p.high,
    nStates: p.nStates,
  }));
  const minT = Math.min(...points.map((p) => p.t));
  const maxT = Math.max(...points.map((p) => p.t));
  const ticks = points.map((p) => p.t);
  const summary = `Event-study chart: estimated percent change in ${label} by years since the policy began, from ${minT} to ${maxT}, with 95% intervals.`;

  return (
    <div className="h-72 text-zinc-500" role="img" aria-label={summary}>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 720, height: 288 }}>
        <ComposedChart data={rows} margin={{ top: 24, right: 12, bottom: 18, left: 0 }}>
          <CartesianGrid stroke="currentColor" strokeOpacity={0.15} vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            domain={[minT - 0.5, maxT + 0.5]}
            ticks={ticks}
            interval={0}
            tick={{ fill: "currentColor", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            label={{
              value: "Years since the policy's first full year",
              position: "insideBottom",
              offset: -12,
              fontSize: 11,
              fill: "currentColor",
            }}
          />
          <YAxis
            width={52}
            tick={{ fill: "currentColor", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${signed(v, 0)}%`}
          />
          <ReferenceArea
            x1={minT - 0.5}
            x2={-0.5}
            fill="currentColor"
            fillOpacity={0.07}
            stroke="none"
            label={{
              value: "Before the policy",
              position: "insideTop",
              fontSize: 10,
              fill: "currentColor",
            }}
          />
          <ReferenceLine y={0} stroke="currentColor" strokeOpacity={0.6} />
          <Tooltip content={(p) => <EventTooltip {...p} />} />
          <Area
            dataKey="band"
            type="linear"
            stroke="none"
            fill="#0284c7"
            fillOpacity={0.18}
            isAnimationActive={false}
            activeDot={false}
            legendType="none"
          />
          <Line
            dataKey="estimate"
            type="linear"
            stroke="#0284c7"
            strokeWidth={2}
            dot={{ r: 3, fill: "#0284c7", stroke: "none" }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
