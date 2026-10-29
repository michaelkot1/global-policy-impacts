import Link from "next/link";
import { signed } from "@/components/evidence";
import { OUTCOME_LABELS, type CheckRow, type EffectDetail } from "@/lib/policy-model";
import { EventStudyChart } from "./event-study-chart";

const CHECK_LABELS: Record<string, string> = {
  headline: "Headline model",
  pretrend: "Pre-trend test",
  randomisation_inference: "Randomisation inference",
  "robust:since_1970": "Full 1970–2022 panel",
  "robust:no_controls": "No population control",
  "robust:gdp_controls": "Adds a GDP control",
  "robust:include_reversals": "Keeps states that left the program",
};

function pText(p: number | null) {
  if (p == null) return "–";
  return p < 0.01 ? "< 0.01" : p.toFixed(2);
}

function CheckTable({ checks }: { checks: CheckRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] text-left text-xs">
        <caption className="sr-only">Checks run on this estimate</caption>
        <thead className="text-zinc-500">
          <tr className="border-b border-zinc-200 dark:border-zinc-800">
            <th scope="col" className="py-1.5 pr-3 font-medium">Check</th>
            <th scope="col" className="py-1.5 pr-3 font-medium">Estimate (95% interval)</th>
            <th scope="col" className="py-1.5 pr-3 font-medium">p-value</th>
            <th scope="col" className="py-1.5 font-medium">States (adopting / comparison)</th>
          </tr>
        </thead>
        <tbody>
          {checks.map((c) => (
            <tr key={c.name} className="border-b border-zinc-100 align-top dark:border-zinc-900">
              <th scope="row" className="py-2 pr-3 font-medium">
                {CHECK_LABELS[c.name] ?? c.name}
                {c.description && (
                  <span className="mt-0.5 block font-normal text-zinc-500">{c.description}</span>
                )}
              </th>
              <td className="py-2 pr-3 tabular-nums">
                {c.estimate != null ? (
                  <>
                    {signed(c.estimate)}%
                    {c.low != null && c.high != null && (
                      <span className="text-zinc-500">
                        {" "}
                        ({signed(c.low)}% to {signed(c.high)}%)
                      </span>
                    )}
                  </>
                ) : (
                  "–"
                )}
              </td>
              <td className="py-2 pr-3 tabular-nums">{pText(c.pValue)}</td>
              <td className="py-2 tabular-nums">
                {c.nTreated != null ? `${c.nTreated} / ${c.nControl ?? "–"}` : "–"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Event-study chart and checks behind each of this site's own (tier B) estimates. */
export function EventStudyDetail({ effects }: { effects: EffectDetail[] }) {
  const own = effects.filter((e) => e.source === "event_study" && e.eventTime.length > 0);
  if (own.length === 0) return null;
  return (
    <section aria-labelledby="own-h" className="mt-12">
      <h2 id="own-h" className="text-xl font-semibold">
        How this site&apos;s estimates were checked
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
        Each estimate compares states that adopted the policy with states that did not, using state
        and year fixed effects. If the two groups were on parallel paths before adoption, the
        points left of the shaded edge should sit near zero. Where they do not, the estimate
        probably overstates the policy&apos;s effect. See the{" "}
        <Link href="/methodology#event-study" className="underline underline-offset-2">
          methodology
        </Link>{" "}
        for the estimator.
      </p>
      <div className="mt-5 space-y-10">
        {own.map((e) => {
          const label = OUTCOME_LABELS[e.outcome ?? ""] ?? e.scope ?? "CO₂";
          return (
            <div key={e.id}>
              <h3 className="font-semibold">{label}</h3>
              <p className="text-xs text-zinc-500">
                {e.scope}
                {e.preTrendP != null && (
                  <>
                    {" · "}pre-trend test p {e.preTrendP < 0.01 ? "< 0.01" : `= ${e.preTrendP.toFixed(2)}`}
                    {e.preTrendP < 0.1 && " (parallel trends rejected)"}
                  </>
                )}
              </p>
              <div className="mt-2">
                <EventStudyChart points={e.eventTime} label={label} />
              </div>
              {e.checks.length > 0 && (
                <div className="mt-3">
                  <CheckTable checks={e.checks} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
