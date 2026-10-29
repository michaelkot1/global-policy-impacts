"use client";

import { useRef, useState } from "react";
import { classOf, formatValue, type Co2Dataset } from "@/lib/co2-model";

/** Sequential palette, low to high. */
export const PALETTE = [
  "#fff5e0",
  "#fde0a8",
  "#fbbf6b",
  "#f58f3c",
  "#dc5a22",
  "#a8341a",
  "#5f1a12",
];

interface Props {
  ds: Co2Dataset;
  /** One value per state, same order as ds.states. */
  values: (number | null)[];
  ranks: (number | null)[];
  breaks: number[];
  unit: string;
  selected: number | null;
  hovered: number | null;
  onHover: (i: number | null) => void;
  onSelect: (i: number) => void;
  label: string;
}

export function UsMap({
  ds,
  values,
  ranks,
  breaks,
  unit,
  selected,
  hovered,
  onHover,
  onSelect,
  label,
}: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number; w: number } | null>(null);
  const { width, height } = ds.mapSize;

  // Draw the highlighted states last so their outline sits on top of neighbours.
  const order = ds.states.map((_, i) => i);
  order.sort(
    (a, b) =>
      Number(a === selected) * 2 + Number(a === hovered) -
      (Number(b === selected) * 2 + Number(b === hovered)),
  );

  const tip = hovered != null ? hovered : null;
  const dc = ds.states.findIndex((s) => s.code === "11");

  return (
    <div
      ref={box}
      className="relative"
      onMouseMove={(e) => {
        const r = box.current?.getBoundingClientRect();
        if (r) setPointer({ x: e.clientX - r.left, y: e.clientY - r.top, w: r.width });
      }}
      onMouseLeave={() => {
        setPointer(null);
        onHover(null);
      }}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${label}. The ranking table next to the map lists the same values.`}
        className="h-auto w-full"
      >
        {order.map((i) => {
          const s = ds.states[i];
          const v = values[i];
          const active = i === selected;
          const hot = i === hovered;
          return (
            <path
              key={s.code}
              d={s.path}
              style={{
                fill: v == null ? "transparent" : PALETTE[classOf(v, breaks)],
                stroke: active || hot ? "var(--foreground)" : "var(--background)",
              }}
              strokeWidth={active ? 2.5 : hot ? 1.75 : 0.75}
              strokeLinejoin="round"
              className="cursor-pointer"
              onMouseEnter={() => onHover(i)}
              onClick={() => onSelect(i)}
            />
          );
        })}
        {/* DC is too small to hit reliably, so give it a larger invisible target. */}
        {dc >= 0 && (
          <circle
            cx={ds.states[dc].centroid[0]}
            cy={ds.states[dc].centroid[1]}
            r={9}
            fill="transparent"
            className="cursor-pointer"
            onMouseEnter={() => onHover(dc)}
            onClick={() => onSelect(dc)}
          />
        )}
      </svg>

      {tip != null && pointer && (
        <div
          role="status"
          className="pointer-events-none absolute z-10 w-max max-w-56 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          style={{
            left: Math.min(pointer.x + 14, pointer.w - 150),
            top: pointer.y + 14,
          }}
        >
          <div className="font-semibold">{ds.states[tip].name}</div>
          <div className="mt-0.5 tabular-nums">
            {formatValue(values[tip])} <span className="text-zinc-500">{unit}</span>
          </div>
          <div className="text-zinc-500">
            {ranks[tip] != null ? `Rank ${ranks[tip]} of ${ranks.filter((r) => r != null).length}` : "No data"}
          </div>
        </div>
      )}
    </div>
  );
}

export function Legend({ breaks, unit }: { breaks: number[]; unit: string }) {
  if (breaks.length === 0) return null;
  const edges = [null, ...breaks, null] as (number | null)[];
  return (
    <div className="mt-2" aria-label={`Colour scale in ${unit}`}>
      <div className="flex">
        {PALETTE.slice(0, breaks.length + 1).map((c, i) => (
          <div key={c} className="flex-1">
            <div className="h-2.5" style={{ background: c }} />
            <div className="mt-1 pr-1 text-[10px] leading-tight tabular-nums text-zinc-500">
              {edges[i] == null ? "<" + formatValue(edges[i + 1]) : formatValue(edges[i])}
              {i === breaks.length ? "+" : ""}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-zinc-500">
        {unit}. Colour classes are fixed across all years, so shades are comparable as the
        slider moves.
      </p>
    </div>
  );
}
