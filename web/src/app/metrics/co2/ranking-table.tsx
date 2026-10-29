"use client";

import Link from "next/link";
import { formatPercentChange, formatValue, stateSlug } from "@/lib/co2-model";
import { PALETTE } from "./us-map";

export interface Row {
  index: number;
  code: string;
  name: string;
  value: number | null;
  rank: number | null;
  /** Fractional change since each baseline year, null if undefined. */
  vs1990: number | null;
  vs2005: number | null;
  swatch: number | null; // palette class
}

export type SortKey = "rank" | "name" | "vs1990" | "vs2005";
export interface Sort {
  key: SortKey;
  dir: "asc" | "desc";
}

interface Props {
  rows: Row[];
  sort: Sort;
  onSort: (key: SortKey) => void;
  selected: number | null;
  hovered: number | null;
  onSelect: (i: number) => void;
  onHover: (i: number | null) => void;
  unit: string;
}

function pct(v: number | null) {
  if (v == null) return "–";
  return formatPercentChange(1 + v, 1);
}

export function RankingTable({
  rows,
  sort,
  onSort,
  selected,
  hovered,
  onSelect,
  onHover,
  unit,
}: Props) {
  const head = (key: SortKey, label: string, align: "left" | "right" = "left") => {
    const active = sort.key === key;
    return (
      <th
        scope="col"
        aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
        className={`sticky top-0 z-10 bg-white px-2 py-2 font-medium dark:bg-zinc-950 ${align === "right" ? "text-right" : "text-left"}`}
      >
        <button
          type="button"
          onClick={() => onSort(key)}
          className={`inline-flex items-center gap-1 rounded hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${active ? "text-foreground" : "text-zinc-500"}`}
        >
          {label}
          <span aria-hidden className="text-[10px]">
            {active ? (sort.dir === "asc" ? "▲" : "▼") : ""}
          </span>
        </button>
      </th>
    );
  };

  return (
    <div className="max-h-[36rem] overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-800 lg:max-h-[calc(100vh-8rem)]">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">
          States ranked by energy-related CO₂ emissions, in {unit}
        </caption>
        <thead className="text-xs">
          <tr className="border-b border-zinc-200 dark:border-zinc-800">
            {head("rank", "Rank")}
            {head("name", "State")}
            <th
              scope="col"
              className="sticky top-0 z-10 bg-white px-2 py-2 text-right text-xs font-medium text-zinc-500 dark:bg-zinc-950"
            >
              {unit}
            </th>
            {head("vs1990", "vs 1990", "right")}
            {head("vs2005", "vs 2005", "right")}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.code}
              onMouseEnter={() => onHover(r.index)}
              onMouseLeave={() => onHover(null)}
              className={`border-b border-zinc-100 dark:border-zinc-900 ${
                r.index === selected
                  ? "bg-amber-50 dark:bg-amber-950/40"
                  : r.index === hovered
                    ? "bg-zinc-100 dark:bg-zinc-900"
                    : ""
              }`}
            >
              <td className="w-10 px-2 py-1.5 tabular-nums text-zinc-500">{r.rank ?? "–"}</td>
              <td className="px-2 py-1.5">
                <button
                  type="button"
                  onClick={() => onSelect(r.index)}
                  aria-pressed={r.index === selected}
                  className="inline-flex items-center gap-2 rounded text-left font-medium hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  <span
                    aria-hidden
                    className="inline-block size-2.5 shrink-0 rounded-sm border border-black/10"
                    style={{ background: r.swatch == null ? "transparent" : PALETTE[r.swatch] }}
                  />
                  {r.name}
                </button>
                <Link
                  href={`/states/${stateSlug(r.name)}`}
                  aria-label={`${r.name} state page`}
                  title={`${r.name} state page`}
                  className="ml-1.5 rounded text-xs text-zinc-400 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  <span aria-hidden>↗</span>
                </Link>
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums">{formatValue(r.value)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                {pct(r.vs1990)}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                {pct(r.vs2005)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
