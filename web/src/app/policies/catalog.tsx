"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { STATUS_LABELS, TierBadge, signed } from "@/components/evidence";
import {
  LEVEL_FILTERS,
  OUTCOME_LABELS,
  levelFilterOf,
  type CatalogEffect,
  type CatalogPolicy,
} from "@/lib/policy-model";
import { KIND_LABELS, TIER_LABELS } from "@/lib/state-model";
import {
  DEFAULT_VIEW,
  SORTS,
  STATUSES,
  TIERS,
  type CatalogView,
  type SortId,
} from "./catalog-view";

/** A number-bearing row: a measured or modelled percent change. */
function isQuantified(e: CatalogEffect | undefined) {
  return !!e && e.estimate != null;
}

function bestTier(p: CatalogPolicy): number {
  const ranks = p.effects.map((e) => TIERS.indexOf(e.tier));
  return ranks.length ? Math.min(...ranks) : TIERS.length;
}

function compare(sort: SortId): (a: CatalogPolicy, b: CatalogPolicy) => number {
  const byTitle = (a: CatalogPolicy, b: CatalogPolicy) => a.title.localeCompare(b.title);
  switch (sort) {
    case "oldest":
      return (a, b) => (a.startYear ?? 9999) - (b.startYear ?? 9999) || byTitle(a, b);
    case "title":
      return byTitle;
    case "effect":
      // Policies with no quantified estimate come last. "Not estimated" is not "no effect".
      return (a, b) => {
        const ea = a.effects[0];
        const eb = b.effects[0];
        const qa = isQuantified(ea);
        const qb = isQuantified(eb);
        if (qa !== qb) return qa ? -1 : 1;
        if (!qa) return byTitle(a, b);
        return (
          Math.abs(eb.impactScore) - Math.abs(ea.impactScore) ||
          Math.abs(eb.estimate!) - Math.abs(ea.estimate!) ||
          byTitle(a, b)
        );
      };
    case "evidence":
      return (a, b) => {
        const qa = a.effects.some(isQuantified);
        const qb = b.effects.some(isQuantified);
        return bestTier(a) - bestTier(b) || Number(qb) - Number(qa) || byTitle(a, b);
      };
    default:
      return (a, b) => (b.startYear ?? 0) - (a.startYear ?? 0) || byTitle(a, b);
  }
}

function matches(p: CatalogPolicy, v: CatalogView) {
  if (v.level !== "all" && levelFilterOf(p.level) !== v.level) return false;
  if (v.status !== "all" && p.status !== v.status) return false;
  if (v.tier !== "all" && !p.effects.some((e) => e.tier === v.tier)) return false;
  if (v.quantified && !p.effects.some(isQuantified)) return false;
  const q = v.q.trim().toLowerCase();
  if (q) {
    const hay = `${p.title} ${p.issuer} ${p.summary ?? ""} ${KIND_LABELS[p.kind] ?? ""}`.toLowerCase();
    if (!q.split(/\s+/).every((word) => hay.includes(word))) return false;
  }
  return true;
}

function percent(v: number) {
  return `${signed(v)}%`;
}

function Headline({ e, extra }: { e: CatalogEffect; extra: CatalogEffect[] }) {
  const quantified = e.estimate != null;
  return (
    <div className="text-sm">
      <TierBadge tier={e.tier} />
      {quantified ? (
        <>
          <p className="mt-2">
            <span className="text-lg font-semibold tabular-nums">{percent(e.estimate!)}</span>{" "}
            <span className="text-zinc-600 dark:text-zinc-400">CO₂</span>
          </p>
          {e.scope && <p className="text-xs text-zinc-500">{e.scope}</p>}
          <p className="mt-1 text-xs tabular-nums text-zinc-600 dark:text-zinc-400">
            Size {signed(e.impactScore, 0)} of ±5
            {e.confidence != null && ` · confidence ${Math.round(e.confidence * 100)}%`}
            {e.scoreBasis === "projection" && " · modelled projection"}
          </p>
        </>
      ) : (
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          {e.scoreBasis === "never_bound"
            ? "Never in force, so no effect."
            : "Effect on CO₂ not estimated. This is not the same as no effect."}
        </p>
      )}
      {extra.length > 0 && (
        <p className="mt-2 border-t border-zinc-200 pt-2 text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          This site&apos;s own estimates:{" "}
          {extra.map((x, i) => (
            <span key={i}>
              {i > 0 && "; "}
              <span className="tabular-nums">{x.estimate != null ? percent(x.estimate) : "–"}</span>{" "}
              {(OUTCOME_LABELS[x.outcome ?? ""] ?? "CO₂").toLowerCase().replace("co₂", "CO₂")}
              {` (tier ${x.tier})`}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

const selectClass =
  "w-full rounded-md border border-zinc-300 bg-background px-2 py-1.5 text-sm dark:border-zinc-700";

export function PolicyCatalog({
  policies,
  initial,
}: {
  policies: CatalogPolicy[];
  initial: CatalogView;
}) {
  const [view, setView] = useState<CatalogView>(initial);
  const set = <K extends keyof CatalogView>(key: K, value: CatalogView[K]) =>
    setView((v) => ({ ...v, [key]: value }));

  // Keep the URL shareable without triggering a navigation.
  useEffect(() => {
    const p = new URLSearchParams();
    if (view.q.trim()) p.set("q", view.q.trim());
    if (view.level !== "all") p.set("level", view.level);
    if (view.status !== "all") p.set("status", view.status);
    if (view.tier !== "all") p.set("tier", view.tier);
    if (view.quantified) p.set("quantified", "1");
    if (view.sort !== DEFAULT_VIEW.sort) p.set("sort", view.sort);
    const qs = p.toString();
    window.history.replaceState(
      window.history.state,
      "",
      qs ? `${window.location.pathname}?${qs}` : window.location.pathname,
    );
  }, [view]);

  const shown = useMemo(
    () => policies.filter((p) => matches(p, view)).sort(compare(view.sort)),
    [policies, view],
  );
  const filtered = JSON.stringify(view) !== JSON.stringify(DEFAULT_VIEW);

  return (
    <div>
      <form
        role="search"
        aria-label="Filter policies"
        onSubmit={(e) => e.preventDefault()}
        className="grid gap-3 rounded-lg border border-zinc-200 p-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr] dark:border-zinc-800"
      >
        <label className="block text-xs font-medium text-zinc-600 sm:col-span-2 lg:col-span-1 dark:text-zinc-400">
          Search
          <input
            type="search"
            value={view.q}
            onChange={(e) => set("q", e.target.value)}
            placeholder="Title, state or topic"
            className={`${selectClass} mt-1`}
          />
        </label>
        <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Level
          <select
            value={view.level}
            onChange={(e) => set("level", e.target.value as CatalogView["level"])}
            className={`${selectClass} mt-1`}
          >
            <option value="all">All levels</option>
            {LEVEL_FILTERS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Status
          <select
            value={view.status}
            onChange={(e) => set("status", e.target.value as CatalogView["status"])}
            className={`${selectClass} mt-1`}
          >
            <option value="all">Any status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Evidence tier
          <select
            value={view.tier}
            onChange={(e) => set("tier", e.target.value as CatalogView["tier"])}
            className={`${selectClass} mt-1`}
          >
            <option value="all">Any tier</option>
            {TIERS.map((t) => (
              <option key={t} value={t}>
                {t} · {TIER_LABELS[t].name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Sort by
          <select
            value={view.sort}
            onChange={(e) => set("sort", e.target.value as SortId)}
            className={`${selectClass} mt-1`}
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2 lg:col-span-5">
          <input
            type="checkbox"
            checked={view.quantified}
            onChange={(e) => set("quantified", e.target.checked)}
            className="size-4"
          />
          Only policies with a quantified effect on CO₂
        </label>
      </form>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
        <p role="status" aria-live="polite" className="text-zinc-600 dark:text-zinc-400">
          Showing <span className="font-medium tabular-nums text-foreground">{shown.length}</span>{" "}
          of <span className="tabular-nums">{policies.length}</span> policies
        </p>
        {filtered && (
          <button
            type="button"
            onClick={() => setView(DEFAULT_VIEW)}
            className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:border-zinc-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-zinc-700"
          >
            Clear filters
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        The tier filter matches any of a policy&apos;s evidence rows. Policies with no quantified
        estimate sort last by effect size, because &ldquo;not estimated&rdquo; is not the same as
        &ldquo;no effect&rdquo;.
      </p>

      <ul className="mt-4 space-y-3">
        {shown.map((p) => {
          const head = p.effects[0];
          const extra = p.effects.slice(1).filter((e) => e.source === "event_study");
          return (
            <li
              key={p.id}
              className="grid gap-4 rounded-lg border border-zinc-200 p-4 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] dark:border-zinc-800"
            >
              <div className="min-w-0">
                <h2 className="font-semibold leading-snug">
                  <Link href={`/policies/${p.slug}`} className="underline-offset-2 hover:underline">
                    {p.title}
                  </Link>
                </h2>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {KIND_LABELS[p.kind] ?? p.kind}
                  {p.issuer !== "United States" && ` · ${p.issuer}`}
                  {p.startYear != null && ` · ${p.coverage === "Never in force" ? "enacted" : "from"} ${p.startYear}`}
                  {p.coverage !== p.issuer && ` · ${p.coverage}`}
                </p>
                {p.status !== "enacted" && (
                  <p className="mt-1 inline-block rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                    {STATUS_LABELS[p.status] ?? p.status}
                    {p.repealed && ` (${p.repealed.slice(0, 4)})`}
                  </p>
                )}
                {p.summary && (
                  <p className="mt-2 line-clamp-3 text-sm text-zinc-600 dark:text-zinc-400">
                    {p.summary}
                  </p>
                )}
              </div>
              <div className="rounded-md bg-zinc-50 p-3 dark:bg-zinc-900">
                {head ? (
                  <Headline e={head} extra={extra} />
                ) : (
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    No evidence record for CO₂ yet.
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {shown.length === 0 && (
        <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">
          No policies match these filters.
        </p>
      )}
    </div>
  );
}
