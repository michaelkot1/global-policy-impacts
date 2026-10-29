"use client";

import { useState } from "react";
import { NORM_LABELS, NORM_UNITS, NORMS, SECTOR_LABELS, type Norm } from "@/lib/co2-model";
import { ordinal, type StatePageData } from "@/lib/state-model";
import { EmissionsChart, RankChart, SECTOR_COLORS, STACK } from "./charts";
import { PolicyList } from "./policy-list";

function NormToggle({
  norm,
  allowed,
  onChange,
}: {
  norm: Norm;
  allowed: Record<Norm, boolean>;
  onChange: (n: Norm) => void;
}) {
  return (
    <div role="group" aria-label="Measure" className="inline-flex rounded-lg border border-zinc-300 p-0.5 text-sm dark:border-zinc-700">
      {NORMS.filter((n) => allowed[n]).map((n) => (
        <button
          key={n}
          type="button"
          aria-pressed={norm === n}
          onClick={() => onChange(n)}
          className={`rounded-md px-3 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
            norm === n ? "bg-foreground text-background" : "text-zinc-600 hover:text-foreground dark:text-zinc-400"
          }`}
        >
          {NORM_LABELS[n]}
        </button>
      ))}
    </div>
  );
}

export function StateExplorer({ data }: { data: StatePageData }) {
  const [norm, setNorm] = useState<Norm>("total");
  const [active, setActive] = useState<number | null>(null);

  const lastYear = data.years[data.years.length - 1];
  const rankAt = (year: number) => {
    const yi = data.years.indexOf(year);
    if (yi < 0) return null;
    const r = data.ranks[norm].rank[yi];
    return r == null ? null : `${ordinal(r)} of ${data.ranks[norm].of[yi]}`;
  };
  const rankPoints = [1990, 2005, lastYear].filter((y) => data.years.includes(y));
  const gdpStart = data.years.find((_, yi) => data.gdp[yi] != null);

  return (
    <>
      <section aria-labelledby="emissions-h" className="mt-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="emissions-h" className="text-xl font-semibold">
              Emissions over time
            </h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Energy-related CO₂ by sector, in {NORM_UNITS[norm].long}.
              {norm !== "total" && " The dashed line is the United States average."}
            </p>
          </div>
          <NormToggle norm={norm} allowed={data.allowed} onChange={setNorm} />
        </div>

        <div className="mt-4">
          <EmissionsChart data={data} norm={norm} activePolicy={active} />
        </div>

        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400" aria-label="Sector colours">
          {[...STACK].reverse().map((k) => (
            <li key={k} className="flex items-center gap-1.5">
              <span aria-hidden className="inline-block size-2.5 rounded-sm" style={{ background: SECTOR_COLORS[k] }} />
              {SECTOR_LABELS[k]}
            </li>
          ))}
        </ul>
        <p className="mt-2 max-w-3xl text-xs text-zinc-500">
          Dashed vertical lines mark the year a policy starts to apply to {data.name}; the
          numbers match the list below, and hovering a policy there highlights the years it was in
          force. The lines show timing, not effect: emissions move for many reasons at once.
          {norm === "per_gdp" && gdpStart != null && ` GDP data start in ${gdpStart}.`}
        </p>
      </section>

      <section aria-labelledby="rank-h" className="mt-12">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="rank-h" className="text-xl font-semibold">
              Rank history
            </h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Position among the 50 states and DC by {NORM_LABELS[norm].toLowerCase()} emissions
              (1st = highest), all sectors.
            </p>
          </div>
          <NormToggle norm={norm} allowed={data.allowed} onChange={setNorm} />
        </div>
        <div className="mt-4">
          <RankChart data={data} norm={norm} />
        </div>
        <dl className="mt-2 flex flex-wrap gap-x-8 gap-y-1 text-sm">
          {rankPoints.map((y) => (
            <div key={y}>
              <dt className="inline text-zinc-500">{y}: </dt>
              <dd className="inline font-medium tabular-nums">{rankAt(y) ?? "–"}</dd>
            </div>
          ))}
        </dl>
        {norm === "per_gdp" && gdpStart != null && (
          <p className="mt-1 text-xs text-zinc-500">Ranks per GDP start in {gdpStart}.</p>
        )}
      </section>

      <section aria-labelledby="policies-h" className="mt-12">
        <h2 id="policies-h" className="text-xl font-semibold">
          Policies that applied to {data.name}
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
          {data.policies.length} policies in the catalog, oldest first. Each shows how strong the
          evidence is (tier) and, separately, how large the estimated effect on CO₂ is. Estimates
          are for the policy&apos;s whole sample (for example all states that adopted it), not for{" "}
          {data.name} alone, and a policy with no estimate has not been measured, which is not the
          same as having no effect.
        </p>
        <div className="mt-4">
          <PolicyList
            state={data.name}
            policies={data.policies}
            lastYear={lastYear}
            active={active}
            onActive={setActive}
          />
        </div>
      </section>
    </>
  );
}

