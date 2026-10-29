"use client";

import { useState } from "react";
import {
  KIND_LABELS,
  TIER_LABELS,
  type EffectRow,
  type EvidenceTier,
  type PolicyPeriod,
  type StatePolicy,
} from "@/lib/state-model";

const STATUS_LABELS: Record<string, string> = {
  enacted: "In force",
  repealed: "Repealed",
  blocked: "Blocked by courts",
  expired: "Expired",
  pending: "Pending",
};

const TIER_STYLES: Record<EvidenceTier, string> = {
  A: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  B: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  C: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  D: "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200",
};

function signed(v: number, digits = 1) {
  const n = new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(Math.abs(v));
  return `${v < 0 ? "−" : v > 0 ? "+" : ""}${n}`;
}

function periodText(p: PolicyPeriod, fallbackStart: string | null) {
  const s = (p.start ?? fallbackStart ?? "").slice(0, 4);
  const e = p.end ? p.end.slice(0, 4) : "present";
  if (!s) return `until ${e}`;
  return s === e ? s : `${s}–${e}`;
}

export function TierBadge({ tier }: { tier: EvidenceTier }) {
  return (
    <span
      title={TIER_LABELS[tier].blurb}
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${TIER_STYLES[tier]}`}
    >
      Tier {tier}
      <span className="font-normal">· {TIER_LABELS[tier].name}</span>
    </span>
  );
}

function EffectBlock({ e }: { e: EffectRow }) {
  const ownEstimate = e.source === "event_study";
  const quantified = e.estimate != null;
  const rangeLabel = ownEstimate ? "95% interval" : "range across specifications";
  const lowPretrend = e.preTrendP != null && e.preTrendP < 0.1;

  return (
    <div className="rounded-md bg-zinc-50 p-3 text-sm dark:bg-zinc-900">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <TierBadge tier={e.tier} />
        {ownEstimate && <span className="text-xs text-zinc-500">This site&apos;s own estimate</span>}
        {e.source === "catalog" && quantified && (
          <span className="text-xs text-zinc-500">Published estimate</span>
        )}
      </div>

      {quantified ? (
        <>
          <p className="mt-2">
            <span className="text-lg font-semibold tabular-nums">
              {signed(e.estimate!)}
              {e.unit === "percent" || e.unit == null ? "%" : ` ${e.unit}`}
            </span>{" "}
            <span className="text-zinc-600 dark:text-zinc-400">
              {e.scope ? `in ${e.scope}` : "change in CO₂"}
            </span>
          </p>
          <dl className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
            {e.low != null && e.high != null && (
              <div>
                <dt className="inline">{rangeLabel}: </dt>
                <dd className="inline tabular-nums">
                  {signed(e.low)}% to {signed(e.high)}%
                </dd>
              </div>
            )}
            <div>
              <dt className="inline">Size (impact score): </dt>
              <dd className="inline tabular-nums">{signed(e.impactScore, 0)} on a −5 to +5 scale</dd>
            </div>
            {e.confidence != null && (
              <div>
                <dt className="inline">Confidence in estimate: </dt>
                <dd className="inline tabular-nums">{Math.round(e.confidence * 100)}%</dd>
              </div>
            )}
            {e.preTrendP != null && (
              <div>
                <dt className="inline">Pre-trend test: </dt>
                <dd className="inline tabular-nums">{e.preTrendP < 0.01 ? "p < 0.01" : `p = ${e.preTrendP.toFixed(2)}`}</dd>
              </div>
            )}
          </dl>
          {e.scoreBasis === "projection" && (
            <p className="mt-1.5 text-xs text-zinc-600 dark:text-zinc-400">
              A modelled projection, not a measured effect.
            </p>
          )}
          {lowPretrend && (
            <p className="mt-1.5 text-xs text-amber-800 dark:text-amber-300">
              States that adopted this policy were already diverging from the others before it
              began, so this estimate probably overstates the policy&apos;s effect.
            </p>
          )}
        </>
      ) : (
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          {e.scoreBasis === "never_bound"
            ? "Never legally applied, so it has no measured effect."
            : "Effect on CO₂ not estimated. This is not the same as no effect."}
        </p>
      )}

      {(e.method || e.mechanism || e.citations.length > 0) && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-400">
            Mechanism, method and citations
          </summary>
          <div className="mt-1.5 space-y-1.5 text-zinc-600 dark:text-zinc-400">
            {e.mechanism && (
              <p>
                <span className="font-medium text-foreground">Mechanism. </span>
                {e.mechanism}
              </p>
            )}
            {e.method && (
              <p>
                <span className="font-medium text-foreground">Method. </span>
                {e.method}
              </p>
            )}
            {e.citations.length > 0 && (
              <ul className="space-y-1">
                {e.citations.map((c, i) => {
                  const href = c.doi ? `https://doi.org/${c.doi}` : c.url;
                  return (
                    <li key={i}>
                      {c.authors && `${c.authors}${c.year ? ` (${c.year}). ` : ". "}`}
                      {href ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline underline-offset-2"
                        >
                          {c.title}
                        </a>
                      ) : (
                        c.title
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

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
                    {p.officialUrl ? (
                      <a
                        href={p.officialUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline-offset-2 hover:underline"
                      >
                        {p.title}
                      </a>
                    ) : (
                      p.title
                    )}
                  </h3>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {KIND_LABELS[p.kind] ?? p.kind}
                    {p.level === "federal" || p.level === "international"
                      ? ` · applies to every state`
                      : ` · ${p.issuer === "United States" ? "multi-state" : p.issuer}`}
                    {" · "}
                    {p.periods.map((per) => periodText(per, fallback)).join(", ")}
                    {offChart && ` · starts after ${lastYear}, not on chart`}
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

