"use client";

import { useEffect, useMemo, useState } from "react";
import {
  NORMS,
  NORM_LABELS,
  NORM_UNITS,
  SECTORS,
  SECTOR_LABELS,
  classBreaks,
  classOf,
  formatValue,
  nationalValueAt,
  valueAt,
  yearRange,
  type Co2Dataset,
  type Norm,
  type Sector,
} from "@/lib/co2-model";
import { PALETTE, Legend, UsMap } from "./us-map";
import { RankingTable, type Row, type Sort, type SortKey } from "./ranking-table";
import { StatePanel } from "./state-panel";

export interface InitialView {
  year?: number;
  norm?: Norm;
  sector?: Sector;
  state?: string; // FIPS
}

const CLASSES = PALETTE.length;
const BASELINES = [1990, 2005] as const;

export function Co2Explorer({ ds, initial }: { ds: Co2Dataset; initial: InitialView }) {
  const firstAllowed = NORMS.find((n) => ds.allowed[n]) ?? "total";
  const lastYear = ds.years[ds.years.length - 1];

  const [norm, setNorm] = useState<Norm>(
    initial.norm && ds.allowed[initial.norm] ? initial.norm : firstAllowed,
  );
  const [sector, setSector] = useState<Sector>(initial.sector ?? "total");
  const [requestedYear, setRequestedYear] = useState(initial.year ?? lastYear);
  const [selected, setSelected] = useState<number | null>(() => {
    const i = ds.states.findIndex((s) => s.code === initial.state);
    return i >= 0 ? i : null;
  });
  const [hovered, setHovered] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [sort, setSort] = useState<Sort>({ key: "rank", dir: "asc" });

  // The year in use is the requested year clamped to what this normalization covers
  // (GDP only starts in 1997). Switching back restores the requested year.
  const [minYear, maxYear] = yearRange(ds, norm);
  const year = Math.min(maxYear, Math.max(minYear, requestedYear));
  const yi = ds.years.indexOf(year);
  const isPlaying = playing && year < maxYear;

  useEffect(() => {
    if (!isPlaying) return;
    const id = setTimeout(() => setRequestedYear(year + 1), 450);
    return () => clearTimeout(id);
  }, [isPlaying, year]);

  // Keep the URL shareable without triggering a navigation.
  useEffect(() => {
    const p = new URLSearchParams();
    if (norm !== firstAllowed) p.set("norm", norm);
    if (sector !== "total") p.set("sector", sector);
    if (year !== lastYear) p.set("year", String(year));
    if (selected != null) p.set("state", ds.states[selected].code);
    const qs = p.toString();
    window.history.replaceState(
      window.history.state,
      "",
      qs ? `${window.location.pathname}?${qs}` : window.location.pathname,
    );
  }, [norm, sector, year, selected, ds.states, firstAllowed, lastYear]);

  const unit = NORM_UNITS[norm];
  const breaks = useMemo(() => classBreaks(ds, sector, norm, CLASSES), [ds, sector, norm]);

  const { values, ranks, rows, rankedCount } = useMemo(() => {
    const n = ds.states.length;
    const values = ds.states.map((_, s) => valueAt(ds, s, yi, sector, norm));
    const order = values
      .map((v, i) => ({ v, i }))
      .filter((x): x is { v: number; i: number } => x.v != null)
      .sort((a, b) => b.v - a.v);
    const ranks: (number | null)[] = new Array(n).fill(null);
    // Tied values share the better rank, as on the state pages and the methodology page.
    order.forEach((x, k) => {
      ranks[x.i] = k > 0 && x.v === order[k - 1].v ? ranks[order[k - 1].i] : k + 1;
    });

    const change = (s: number, base: number) => {
      const bi = ds.years.indexOf(base);
      if (bi < 0 || year <= base) return null;
      const b = valueAt(ds, s, bi, sector, norm);
      const v = values[s];
      return b == null || b === 0 || v == null ? null : (v - b) / b;
    };

    const rows: Row[] = ds.states.map((st, s) => ({
      index: s,
      code: st.code,
      name: st.name,
      value: values[s],
      rank: ranks[s],
      vs1990: change(s, BASELINES[0]),
      vs2005: change(s, BASELINES[1]),
      swatch: values[s] == null ? null : classOf(values[s], breaks),
    }));
    return { values, ranks, rows, rankedCount: order.length };
  }, [ds, yi, year, sector, norm, breaks]);

  const sortedRows = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    const copy = [...rows];
    copy.sort((a, b) => {
      if (sort.key === "name") return a.name.localeCompare(b.name) * dir;
      // "rank" ascending means largest value first; nulls always go last.
      const key = sort.key as "rank" | "vs1990" | "vs2005";
      const av = a[key];
      const bv = b[key];
      if (av == null && bv == null) return a.name.localeCompare(b.name);
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av - bv) * dir;
    });
    return copy;
  }, [rows, sort]);

  const national = nationalValueAt(ds, yi, sector, norm);

  const onSort = (key: SortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "name" || key === "rank" ? "asc" : "desc" },
    );

  const selectedPanel = useMemo(() => {
    if (selected == null) return null;
    const series = ds.years.map((y, k) => ({
      year: y,
      value: valueAt(ds, selected, k, sector, norm),
    }));
    let share: number | null = null;
    if (norm === "total") {
      const nat = nationalValueAt(ds, yi, sector, "total");
      share = nat && values[selected] != null ? values[selected]! / nat : null;
    }
    return { series, share };
  }, [selected, ds, sector, norm, yi, values]);

  const toggleSelect = (i: number) => setSelected((cur) => (cur === i ? null : i));

  const mapLabel = `Map of ${NORM_LABELS[norm].toLowerCase()} ${SECTOR_LABELS[sector].toLowerCase()} energy-related CO₂ emissions by state in ${year}`;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="min-w-0">
        {/* Controls */}
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <fieldset>
            <legend className="mb-1 text-xs font-medium text-zinc-500">Measure</legend>
            <div className="inline-flex rounded-lg border border-zinc-300 p-0.5 dark:border-zinc-700">
              {NORMS.filter((n) => ds.allowed[n]).map((n) => (
                <label
                  key={n}
                  className={`cursor-pointer rounded-md px-3 py-1 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 ${
                    norm === n
                      ? "bg-foreground text-background"
                      : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
                  }`}
                >
                  <input
                    type="radio"
                    name="norm"
                    value={n}
                    checked={norm === n}
                    onChange={() => setNorm(n)}
                    className="sr-only"
                  />
                  {NORM_LABELS[n]}
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor="sector" className="mb-1 block text-xs font-medium text-zinc-500">
              Sector
            </label>
            <select
              id="sector"
              value={sector}
              onChange={(e) => setSector(e.target.value as Sector)}
              className="rounded-lg border border-zinc-300 bg-background px-3 py-1.5 text-sm dark:border-zinc-700"
            >
              {SECTORS.map((s) => (
                <option key={s} value={s}>
                  {SECTOR_LABELS[s]}
                </option>
              ))}
            </select>
          </div>

          <div className="ml-auto text-right">
            <div className="text-xs font-medium text-zinc-500">
              United States, {year}
            </div>
            <div className="text-lg font-semibold tabular-nums leading-tight">
              {formatValue(national)}{" "}
              <span className="text-xs font-normal text-zinc-500">{unit.short}</span>
            </div>
          </div>
        </div>

        {/* Year slider */}
        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              if (isPlaying) {
                setPlaying(false);
              } else {
                if (year >= maxYear) setRequestedYear(minYear);
                setPlaying(true);
              }
            }}
            aria-label={isPlaying ? "Pause" : "Play through the years"}
            className="grid size-9 shrink-0 place-items-center rounded-full border border-zinc-300 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            <span aria-hidden>{isPlaying ? "❚❚" : "▶"}</span>
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between">
              <label htmlFor="year" className="text-xs font-medium text-zinc-500">
                Year
              </label>
              <output
                htmlFor="year"
                className="text-3xl font-semibold tabular-nums leading-none tracking-tight"
              >
                {year}
              </output>
            </div>
            <input
              id="year"
              type="range"
              min={minYear}
              max={maxYear}
              step={1}
              value={year}
              onChange={(e) => {
                setPlaying(false);
                setRequestedYear(Number(e.target.value));
              }}
              className="mt-1 w-full accent-[#dc5a22]"
            />
            <div className="flex justify-between text-[11px] tabular-nums text-zinc-500">
              <span>{minYear}</span>
              <span>{maxYear}</span>
            </div>
          </div>
        </div>
        {norm === "per_gdp" && (
          <p className="mt-1 text-xs text-zinc-500">
            State GDP data starts in {minYear}, so earlier years are unavailable for this measure.
          </p>
        )}

        {/* Map */}
        <div className="mt-4">
          <UsMap
            ds={ds}
            values={values}
            ranks={ranks}
            breaks={breaks}
            unit={unit.short}
            selected={selected}
            hovered={hovered}
            onHover={setHovered}
            onSelect={toggleSelect}
            label={mapLabel}
          />
          <Legend breaks={breaks} unit={unit.long} />
        </div>

        <div className="mt-5">
          {selected != null && selectedPanel ? (
            <StatePanel
              name={ds.states[selected].name}
              year={year}
              unit={unit.short}
              value={values[selected]}
              rank={ranks[selected]}
              rankedCount={rankedCount}
              share={selectedPanel.share}
              vs2005={rows[selected].vs2005}
              series={selectedPanel.series}
              onClear={() => setSelected(null)}
            />
          ) : (
            <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700">
              Select a state on the map or in the table to see its history for this measure.
            </p>
          )}
        </div>
      </div>

      <div className="min-w-0 lg:sticky lg:top-4 lg:self-start">
        <RankingTable
          rows={sortedRows}
          sort={sort}
          onSort={onSort}
          selected={selected}
          hovered={hovered}
          onSelect={toggleSelect}
          onHover={setHovered}
          unit={unit.short}
        />
      </div>
    </div>
  );
}
