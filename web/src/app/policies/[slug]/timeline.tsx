import Link from "next/link";
import { periodText } from "@/components/evidence";
import { describeJurisdictions, type CoverageGroup } from "@/lib/policy-model";

/** "2015-12-22" -> 2015.97 (fraction of the year elapsed), so bars start and end mid-year. */
function decimalYear(iso: string, endOfDay = false): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return NaN;
  const month = Number(m[2]) - 1;
  const day = Number(m[3]) - 1 + (endOfDay ? 1 : 0);
  return Number(m[1]) + (month + day / 31) / 12;
}

function tickStep(span: number) {
  if (span > 70) return 10;
  if (span > 30) return 5;
  if (span > 14) return 2;
  return 1;
}

const OPEN_END_ARROW =
  "polygon(0 0, calc(100% - 7px) 0, 100% 50%, calc(100% - 7px) 100%, 0 100%)";

interface Props {
  groups: CoverageGroup[];
  allStateNames: string[];
  dataEndYear: number;
  fallbackStart: string | null;
}

/** Which jurisdictions the policy applied to, and when. One row per set of identical dates. */
export function CoverageTimeline({ groups, allStateNames, dataEndYear, fallbackStart }: Props) {
  const startYears: number[] = [];
  const endYears: number[] = [];
  for (const g of groups) {
    for (const p of g.periods) {
      const s = p.start ?? fallbackStart;
      if (s) startYears.push(decimalYear(s));
      if (p.end) endYears.push(decimalYear(p.end, true));
    }
  }
  const axisMin = Math.floor(Math.min(...startYears, dataEndYear) / 5) * 5;
  const axisMax = Math.ceil(Math.max(...startYears, ...endYears, dataEndYear + 1));
  const span = axisMax - axisMin;
  const pct = (y: number) => `${((y - axisMin) / span) * 100}%`;
  const step = tickStep(span);
  const ticks: number[] = [];
  for (let t = Math.ceil(axisMin / step) * step; t <= axisMax; t += step) ticks.push(t);
  const dataEnd = dataEndYear + 1;

  return (
    <figure>
      <div className="grid grid-cols-[minmax(7rem,12rem)_minmax(0,1fr)] gap-x-3 text-xs sm:grid-cols-[minmax(10rem,16rem)_minmax(0,1fr)]">
        {/* Axis */}
        <div />
        <div className="relative h-5 text-zinc-500" aria-hidden>
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute -translate-x-1/2 tabular-nums"
              style={{ left: pct(t) }}
            >
              {t}
            </span>
          ))}
        </div>

        <ol className="contents">
          {groups.map((g, i) => {
            const names = g.jurisdictions.map((j) => j.name);
            const linkable = g.jurisdictions.length <= 12;
            return (
              <li key={i} className="contents">
                <div className="border-t border-zinc-200 py-2 pr-1 dark:border-zinc-800">
                  <p className="leading-snug">
                    {linkable ? (
                      g.jurisdictions.map((j, k) => (
                        <span key={j.name}>
                          {k > 0 && ", "}
                          {j.slug ? (
                            <Link
                              href={`/states/${j.slug}`}
                              className="font-medium underline-offset-2 hover:underline"
                            >
                              {j.name}
                            </Link>
                          ) : (
                            <span className="font-medium">{j.name}</span>
                          )}
                        </span>
                      ))
                    ) : (
                      <span className="font-medium">
                        {describeJurisdictions(names, allStateNames)}
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 tabular-nums text-zinc-500">
                    {g.periods.map((p) => periodText(p, fallbackStart)).join(", ")}
                  </p>
                </div>
                <div
                  className="relative border-t border-zinc-200 dark:border-zinc-800"
                  role="img"
                  aria-label={`${describeJurisdictions(names, allStateNames)}: ${g.periods
                    .map((p) => periodText(p, fallbackStart))
                    .join(", ")}`}
                >
                  {ticks.map((t) => (
                    <span
                      key={t}
                      aria-hidden
                      className="absolute inset-y-0 border-l border-zinc-100 dark:border-zinc-900"
                      style={{ left: pct(t) }}
                    />
                  ))}
                  <span
                    aria-hidden
                    className="absolute inset-y-0 border-l border-dashed border-zinc-400"
                    style={{ left: pct(dataEnd) }}
                  />
                  {g.periods.map((p, k) => {
                    const s = decimalYear(p.start ?? fallbackStart ?? "");
                    if (!Number.isFinite(s)) return null;
                    const open = !p.end;
                    const e = open ? axisMax : decimalYear(p.end!, true);
                    return (
                      <span
                        key={k}
                        aria-hidden
                        className="absolute top-1/2 h-3 -translate-y-1/2 rounded-sm bg-orange-600"
                        style={{
                          left: pct(s),
                          width: `max(3px, ${((e - s) / span) * 100}%)`,
                          clipPath: open ? OPEN_END_ARROW : undefined,
                        }}
                      />
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
      <figcaption className="mt-2 text-xs text-zinc-500">
        Bars show when the policy legally applied. An arrow means it was still in force at the
        last date in the catalog. The dashed line marks the end of the CO₂ data ({dataEndYear}).
      </figcaption>
    </figure>
  );
}
