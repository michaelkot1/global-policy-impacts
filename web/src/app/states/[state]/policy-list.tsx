"use client";

import Link from "next/link";
import { useState } from "react";
import { EffectBlock, STATUS_LABELS, periodText } from "@/components/evidence";
import { KIND_LABELS, type StatePolicy } from "@/lib/state-model";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "federal", label: "Federal" },
  { id: "state", label: "State and interstate" },
  { id: "international", label: "International" },
] as const;
type Filter = (typeof FILTERS)[number]["id"];

interface Props {
  state: string;
  policies: StatePolicy[];
  lastYear: number;
  active: number | null;
  onActive: (n: number | null) => void;
}

export function PolicyList({ state, policies, lastYear, active, onActive }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const shown = policies.filter((p) =>
    filter === "all"
      ? true
      : filter === "state"
        ? p.level === "state" || p.level === "interstate"
        : p.level === filter,
  );

  return (
    <div>
      <div role="group" aria-label="Filter policies by level" className="mb-3 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const count =
            f.id === "all"
              ? policies.length
              : policies.filter((p) =>
                  f.id === "state" ? p.level === "state" || p.level === "interstate" : p.level === f.id,
                ).length;
          if (f.id !== "all" && count === 0) return null;
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={`rounded-full border px-3 py-1 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
                filter === f.id
                  ? "border-foreground bg-foreground text-background"
                  : "border-zinc-300 text-zinc-600 hover:border-zinc-500 dark:border-zinc-700 dark:text-zinc-400"
              }`}
            >
              {f.label} <span className="tabular-nums opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      <ol className="space-y-3">
        {shown.map((p) => {
          const fallback = p.enacted;
          const offChart = p.markerYears.length === 0;
          const isActive = active === p.n;
          return (
            <li
              key={p.id}
              onMouseEnter={() => onActive(p.n)}
              onMouseLeave={() => onActive(null)}
              onFocus={() => onActive(p.n)}
              onBlur={() => onActive(null)}
              className={`rounded-lg border p-4 ${
                isActive
                  ? "border-amber-500 bg-amber-50/50 dark:bg-amber-950/20"
                  : "border-zinc-200 dark:border-zinc-800"
              }`}
            >
              <div className="flex items-start gap-3">
                <span
                  aria-label={`Marker ${p.n}`}
                  className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-xs font-semibold tabular-nums text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200"
                >
                  {p.n}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold leading-snug">
                    <Link
                      href={`/policies/${p.slug}`}
                      className="underline-offset-2 hover:underline"
                    >
                      {p.title}
                    </Link>
                  </h3>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {KIND_LABELS[p.kind] ?? p.kind}
                    {p.level === "federal" || p.level === "international"
                      ? ` · applies to every state`
                      : ` · ${p.issuer === "United States" ? "multi-state" : p.issuer}`}
                    {" · "}
                    {p.periods.map((per) => periodText(per, fallback)).join(", ")}
                    {offChart && ` · starts after ${lastYear}, not on chart`}
                    {p.officialUrl && (
                      <>
                        {" · "}
                        <a
                          href={p.officialUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline underline-offset-2"
                        >
                          Official source
                        </a>
                      </>
                    )}
                  </p>
                  {(p.status !== "enacted" || p.repealed) && (
                    <p className="mt-1 inline-block rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                      {STATUS_LABELS[p.status] ?? p.status}
                      {p.repealed && ` (${p.repealed.slice(0, 4)})`}
                    </p>
                  )}
                  {p.summary && (
                    <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{p.summary}</p>
                  )}
                  {p.periods.some((per) => per.notes) && (
                    <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-zinc-500">
                      {p.periods
                        .filter((per) => per.notes)
                        .map((per, i) => (
                          <li key={i}>
                            <span className="tabular-nums">{periodText(per, fallback)}:</span> {per.notes}
                          </li>
                        ))}
                    </ul>
                  )}
                  <div className="mt-3 space-y-2">
                    {p.effects.length === 0 ? (
                      <p className="text-sm text-zinc-600 dark:text-zinc-400">
                        No evidence record for CO₂ yet.
                      </p>
                    ) : (
                      p.effects.map((e) => <EffectBlock key={e.id} e={e} />)
                    )}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {shown.length === 0 && (
        <p className="text-sm text-zinc-500">No policies at this level apply to {state}.</p>
      )}
    </div>
  );
}

