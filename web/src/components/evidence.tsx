import {
  TIER_LABELS,
  type EffectRow,
  type EvidenceTier,
  type PolicyPeriod,
} from "@/lib/state-model";

// Shared by the state pages and the policy pages: how a policy's status, evidence tier and
// CO2 effect estimates are shown. No hooks, so it works in server and client components.

export const STATUS_LABELS: Record<string, string> = {
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

export function signed(v: number, digits = 1) {
  const n = new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(Math.abs(v));
  return `${v < 0 ? "−" : v > 0 ? "+" : ""}${n}`;
}

export function periodText(p: PolicyPeriod, fallbackStart: string | null) {
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

export function EffectBlock({ e }: { e: EffectRow }) {
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
