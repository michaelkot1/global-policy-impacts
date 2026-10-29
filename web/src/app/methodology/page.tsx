import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { TierBadge } from "@/components/evidence";
import { getMethodologyData, type MethodologyData } from "@/lib/methodology-data";
import { TIER_LABELS, type EvidenceTier } from "@/lib/state-model";

export const metadata: Metadata = {
  title: "Methodology",
  description:
    "How the metrics are defined and normalized, what the evidence tiers and impact score mean, how this site's own estimates are made, and the limits of the data.",
};

const TOC = [
  { id: "metrics", label: "Metrics and sources" },
  { id: "normalization", label: "Totals, per capita and per GDP" },
  { id: "evidence-tiers", label: "Evidence tiers" },
  { id: "impact-score", label: "Impact score" },
  { id: "confidence", label: "Confidence" },
  { id: "event-study", label: "This site's own estimates" },
  { id: "applicability", label: "Dates and coverage" },
  { id: "limitations", label: "Limitations" },
  { id: "sources", label: "Policy and research sources" },
];

const TIER_RULES: Record<EvidenceTier, string> = {
  A: "Peer-reviewed quasi-experimental evidence, such as difference-in-differences or synthetic control. A tier A estimate needs a percent estimate and a peer-reviewed citation with a DOI. A working paper does not qualify until it is published.",
  B: "This site's own event-study estimate from state data, labelled as such and shown with a 95% interval and a pre-trend test. It is only possible where some states adopted a policy and others did not, or adopted it in different years.",
  C: "A correlation or descriptive trend. It may carry a number, but the design does not isolate the policy from everything else that changed.",
  D: "A plausible mechanism with no measured effect. It may carry a modelled projection (not a measurement), and is labelled as one.",
};

const BINS: { range: string; score: string }[] = [
  { range: "Under 0.5%", score: "0" },
  { range: "0.5% to under 2%", score: "±1" },
  { range: "2% to under 5%", score: "±2" },
  { range: "5% to under 10%", score: "±3" },
  { range: "10% to under 20%", score: "±4" },
  { range: "20% or more", score: "±5" },
];

const SCORE_BASES: { id: string; meaning: string; shown: string }[] = [
  {
    id: "estimate",
    meaning: "Binned from a percent estimate (tiers A, B and C). The tier says how far to trust it.",
    shown: "The score, with its tier and confidence.",
  },
  {
    id: "projection",
    meaning: "Binned from a modelled projection (tier D only). Nothing has been measured.",
    shown: "The score, labelled as a modelled projection.",
  },
  {
    id: "never_bound",
    meaning:
      "The policy never applied to anyone (for example a rule stayed by a court before compliance began), so its effect is zero by construction.",
    shown: "\u201CNever in force\u201D, with no score.",
  },
  {
    id: "unquantified",
    meaning:
      "Nobody has quantified the effect on CO₂, so the stored score is 0. That means \u201Cno quantified effect\u201D, not \u201Cno effect\u201D.",
    shown: "\u201CEffect on CO₂ not estimated\u201D, with no score.",
  },
];

const CONFIDENCE_RUBRIC: { band: string; meaning: string }[] = [
  { band: "0.7 to 1.0", meaning: "Several independent studies agree on sign and rough size." },
  {
    band: "0.4 to 0.7",
    meaning: "One or two credible studies, robust across the checks they report.",
  },
  {
    band: "0.2 to 0.4",
    meaning:
      "One study with fragile, specification-sensitive or conflicting results, or an unfinished paper that has no DOI yet.",
  },
  { band: "Under 0.2", meaning: "A model projection, or evidence that is largely indirect." },
];

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mt-12 scroll-mt-6 text-xl font-semibold tracking-tight">
      {children}
    </h2>
  );
}

function Table({
  caption,
  head,
  children,
}: {
  caption: string;
  head: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[28rem] text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="text-xs text-zinc-500">
          <tr className="border-b border-zinc-200 dark:border-zinc-800">
            {head.map((h) => (
              <th key={h} scope="col" className="py-1.5 pr-4 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

const rowClass = "border-b border-zinc-100 align-top dark:border-zinc-900";

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2"
    >
      {children}
    </a>
  );
}

function Metrics({ d }: { d: MethodologyData }) {
  return (
    <>
      <H2 id="metrics">Metrics and sources</H2>
      <p className="mt-2">
        Version 1 tracks one outcome, energy-related CO₂ emissions of the 50 states and
        DC, {d.firstYear} to {d.lastYear}. Population and GDP are loaded alongside it only to
        divide emissions into per-capita and per-GDP measures. Every number links back to a named
        source below.
      </p>
      <div className="mt-4 space-y-4">
        {d.metrics.map((m) => (
          <div key={m.slug} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <h3 className="font-semibold">{m.name}</h3>
            <dl className="mt-2 space-y-2 text-sm">
              <div>
                <dt className="inline font-medium">Unit: </dt>
                <dd className="inline text-zinc-600 dark:text-zinc-400">{m.unit}</dd>
              </div>
              {m.slug === "co2" && (
                <div>
                  <dt className="inline font-medium">Direction: </dt>
                  <dd className="inline text-zinc-600 dark:text-zinc-400">
                    {m.higherIsBetter ? "Higher is better." : "Lower is better."} A fall in
                    emissions counts as an improvement in the impact score.
                  </dd>
                </div>
              )}
              <div>
                <dt className="inline font-medium">Available as: </dt>
                <dd className="inline text-zinc-600 dark:text-zinc-400">
                  {m.normalizations.join(", ")}
                </dd>
              </div>
              {m.definition && (
                <div>
                  <dt className="inline font-medium">Definition: </dt>
                  <dd className="inline text-zinc-600 dark:text-zinc-400">{m.definition}</dd>
                </div>
              )}
              {m.methodology && (
                <div>
                  <dt className="inline font-medium">Method: </dt>
                  <dd className="inline text-zinc-600 dark:text-zinc-400">{m.methodology}</dd>
                </div>
              )}
              {m.sources.length > 0 && (
                <div>
                  <dt className="inline font-medium">Source: </dt>
                  <dd className="inline">
                    {m.sources.map((s, i) => (
                      <span key={s.name}>
                        {i > 0 && "; "}
                        {s.url ? <ExtLink href={s.url}>{s.name}</ExtLink> : s.name}
                        {s.publisher && (
                          <span className="text-zinc-500">, {s.publisher}</span>
                        )}
                      </span>
                    ))}
                  </dd>
                </div>
              )}
            </dl>
          </div>
        ))}
      </div>
    </>
  );
}

function Normalization({ d }: { d: MethodologyData }) {
  return (
    <>
      <H2 id="normalization">Totals, per capita and per GDP</H2>
      <ul className="mt-2 list-disc space-y-2 pl-5 text-zinc-700 dark:text-zinc-300">
        <li>
          <strong className="font-medium text-foreground">Emissions are counted where the fuel is
          burned.</strong> A state that exports electricity is charged for the power plants inside
          it, not for the people who use the power. Emissions from imported goods are not counted.
        </li>
        <li>
          <strong className="font-medium text-foreground">Per capita</strong> divides by Census
          population. Before 2000 annual population is interpolated between decennial counts.
        </li>
        <li>
          <strong className="font-medium text-foreground">Per GDP</strong> divides by BEA state GDP
          in current (not inflation-adjusted) dollars, so the figure falls partly because prices
          rise. It starts in 1997, and is best used to compare states within one year rather than
          over time.
        </li>
        <li>
          <strong className="font-medium text-foreground">The United States figure</strong> is the
          sum of the 50 states and DC. The data pipeline checks that sum against EIA&apos;s
          national total every year and fails if they differ by more than 1%.
        </li>
        <li>
          <strong className="font-medium text-foreground">Ranks</strong> are among all{" "}
          {d.stateCount} jurisdictions with data in that year, 1 being the highest. Tied states
          share the better rank. A rank shows where emissions are, not what any policy caused.
        </li>
        <li>
          <strong className="font-medium text-foreground">Sectors</strong> are residential,
          commercial, industrial, transportation and electric power, as EIA reports them. Electric
          power emissions are attributed to the state where the plant stands.
        </li>
      </ul>
    </>
  );
}

function Tiers({ d }: { d: MethodologyData }) {
  return (
    <>
      <H2 id="evidence-tiers">Evidence tiers</H2>
      <p className="mt-2">
        Every link between a policy and a metric carries a tier that describes the{" "}
        <em>design</em> of the evidence, so a correlation is never presented as a cause. The tier
        describes the kind of evidence; how much to trust one particular number is the{" "}
        <a href="#confidence" className="underline underline-offset-2">
          confidence
        </a>
        , and the two are never merged.
      </p>
      <Table caption="Evidence tiers" head={["Tier", "Rule", "Policies with a CO₂ row at this tier"]}>
        {(["A", "B", "C", "D"] as const).map((t) => (
          <tr key={t} className={rowClass}>
            <th scope="row" className="py-3 pr-4 font-normal">
              <TierBadge tier={t} />
              <span className="mt-1 block text-xs text-zinc-500">{TIER_LABELS[t].blurb}</span>
            </th>
            <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">{TIER_RULES[t]}</td>
            <td className="py-3 tabular-nums">{d.policiesByTier[t]}</td>
          </tr>
        ))}
      </Table>
      <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
        A policy can have several rows, for example a published tier A estimate beside this
        site&apos;s own tier B estimates. The published estimate is shown first. Federal policies
        apply to every state they cover at the same time, so they have no unaffected comparison group and stay at tier
        C or D unless a published study found another way to isolate the effect.
      </p>
    </>
  );
}

function ImpactScore({ d }: { d: MethodologyData }) {
  return (
    <>
      <H2 id="impact-score">Impact score</H2>
      <p className="mt-2">
        The impact score is a number from −5 to +5 for the <strong className="font-medium">size</strong>{" "}
        of a policy&apos;s estimated effect. It says nothing about how far to trust the estimate.
      </p>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-zinc-700 dark:text-zinc-300">
        <li>
          <strong className="font-medium text-foreground">Input.</strong> The estimated percent
          change in the metric attributable to the policy.
        </li>
        <li>
          <strong className="font-medium text-foreground">Sign.</strong> Positive means the metric
          moved in its desired direction. For CO₂, lower is better, so a 20% fall scores +5 and a
          20% rise scores −5.
        </li>
        <li>
          <strong className="font-medium text-foreground">Size.</strong> The absolute percent
          change is placed in a bin:
        </li>
      </ul>
      <Table caption="Impact score bins" head={["Absolute percent change", "Score"]}>
        {BINS.map((b) => (
          <tr key={b.range} className={rowClass}>
            <td className="py-1.5 pr-4">{b.range}</td>
            <td className="py-1.5 tabular-nums">{b.score}</td>
          </tr>
        ))}
      </Table>
      <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
        Scores are not rescaled to statewide CO₂. Each one describes what its estimate measures,
        such as power-sector CO₂ in RGGI states, transportation CO₂ in California, or all
        greenhouse gases nationally in 2030, so scores of different policies are not directly
        comparable. A score near a bin edge can flip with a small change in the estimate.
      </p>
      <h3 className="mt-6 font-semibold">What a score is based on</h3>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        A score of 0 can mean two very different things, so each link records its basis.{" "}
        {d.unquantifiedCount} of {d.policyCount} policies currently have no quantified effect on
        CO₂; they are shown as &ldquo;not estimated&rdquo; and are never ranked as having zero
        impact.
      </p>
      <Table caption="Bases of the impact score" head={["Basis", "What it means", "Shown as"]}>
        {SCORE_BASES.map((b) => (
          <tr key={b.id} className={rowClass}>
            <th scope="row" className="py-2 pr-4 font-mono text-xs font-normal">
              {b.id}
            </th>
            <td className="py-2 pr-4 text-zinc-700 dark:text-zinc-300">{b.meaning}</td>
            <td className="py-2 text-zinc-600 dark:text-zinc-400">{b.shown}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}

function Confidence() {
  return (
    <>
      <H2 id="confidence">Confidence</H2>
      <p className="mt-2">
        Confidence, from 0 to 100%, is how far to trust one particular estimate. It is set by hand
        for every estimate and projection, using this rubric, and is left blank where there is no
        estimate. These values are judgement calls, not statistics.
      </p>
      <Table caption="Confidence rubric" head={["Confidence", "Typical evidence"]}>
        {CONFIDENCE_RUBRIC.map((c) => (
          <tr key={c.band} className={rowClass}>
            <td className="py-1.5 pr-4 tabular-nums">{c.band}</td>
            <td className="py-1.5 text-zinc-700 dark:text-zinc-300">{c.meaning}</td>
          </tr>
        ))}
      </Table>
      <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
        This site&apos;s own estimates use a fixed rule instead: 50%, minus 15 points if the
        pre-trend test rejects at the 10% level, minus 15 if any robustness check flips the sign,
        and minus 10 if the randomisation-inference p-value is above 0.10, never below 10%.
      </p>
    </>
  );
}

function EventStudy({ d }: { d: MethodologyData }) {
  const own = d.ownEstimates;
  return (
    <>
      <H2 id="event-study">This site&apos;s own estimates (tier B)</H2>
      <p className="mt-2">
        Where states adopted a policy in different years, this site estimates its effect from the
        state data. It does this for {own.policies.length > 0 ? own.policies.join(" and ") : "no policy yet"}
        , on two outcomes: electric-power-sector CO₂ and total CO₂ per person.
      </p>
      <ul className="mt-2 list-disc space-y-2 pl-5 text-zinc-700 dark:text-zinc-300">
        <li>
          <strong className="font-medium text-foreground">Design.</strong> A staggered
          difference-in-differences, also called an event study, with state and year fixed effects
          and a control for log population. It asks how much CO₂ fell in adopting states compared
          with states without the policy, relative to how they differed before.
        </li>
        <li>
          <strong className="font-medium text-foreground">Estimator.</strong> The imputation
          estimator of{" "}
          <ExtLink href="https://doi.org/10.1093/restud/rdae007">
            Borusyak, Jaravel and Spiess (2024)
          </ExtLink>
          . A plain two-way fixed-effects regression is biased when adoption is staggered, because
          states that adopted earlier act as controls for later ones. The imputation estimator
          fits the model on untreated state-years only and compares each treated state-year with
          its own prediction.
        </li>
        <li>
          <strong className="font-medium text-foreground">Window.</strong> The headline model uses
          1990 to {d.lastYear}, the era of the published studies. The full 1970 to {d.lastYear}{" "}
          panel is reported as a robustness check; it failed the pre-trend test in every model,
          which is why the headline window starts in 1990.
          Choosing the window after seeing the data is a judgement call, so the pre-trend p-values
          describe the fit and are not a clean test.
        </li>
        <li>
          <strong className="font-medium text-foreground">Uncertainty.</strong> 95% intervals come
          from a bootstrap over states. With only nine adopting states in the RGGI power-sector
          model those can be too narrow, so a randomisation-inference p-value (re-assigning
          adoption paths across states at random) is stored beside them.
        </li>
        <li>
          <strong className="font-medium text-foreground">Pre-trend test.</strong> The years before
          adoption are tested jointly against zero. Parallel trends, the assumption that adopting
          states would have followed the others, can be contradicted by this test but never proved
          by it.
        </li>
        <li>
          <strong className="font-medium text-foreground">Checks shown on each policy page.</strong>{" "}
          The full panel since 1970, no population control, a GDP control (BEA data start in 1997,
          so only states adopting from 2000 qualify), and keeping states that later left a program
          as treated from first adoption.
        </li>
      </ul>
      {own.count > 0 && (
        <p className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-200">
          The pre-trend test rejects at the 10% level for {own.preTrendRejected} of the{" "}
          {own.count} estimates. Where it does, adopting states were already drifting down
          relative to the others before the policy began, so the estimate probably overstates its
          effect. Those rows carry a lower confidence and a warning on the page.
        </p>
      )}
    </>
  );
}

function Applicability() {
  return (
    <>
      <H2 id="applicability">Dates and coverage</H2>
      <ul className="mt-2 list-disc space-y-2 pl-5 text-zinc-700 dark:text-zinc-300">
        <li>
          A policy&apos;s coverage is a list of jurisdictions with start and end dates, kept apart
          from its enactment date. That handles states joining, leaving and returning (for
          example New Jersey and Virginia in RGGI), the Paris Agreement for the United States, and
          federal rules that courts blocked.
        </li>
        <li>
          A policy that never bound anyone, such as the Clean Power Plan, stays in the catalog
          marked as never in force. It cannot explain any state&apos;s emissions.
        </li>
        <li>
          State pages mark a policy at the calendar year its application starts, so a policy that
          took effect in December sits on that year&apos;s point. A marker shows when a policy
          began to apply, not what it caused.
        </li>
        <li>
          Where the catalog knows only a year or month, start dates are set to the first day and
          end dates to the last day of that period. For RPS standards the start year is the
          Lawrence Berkeley National Laboratory enactment year, which for several states is
          earlier than the date the standard became binding, so measured effects are probably
          attenuated.
        </li>
      </ul>
    </>
  );
}

function Limitations({ d }: { d: MethodologyData }) {
  const items: React.ReactNode[] = [
    <>
      <strong className="font-medium text-foreground">One metric, and not all emissions.</strong>{" "}
      Only energy-related CO₂ is covered, not other greenhouse gases, land use or emissions
      embedded in imports. The latest year is {d.lastYear}, because that is what EIA has
      published.
    </>,
    <>
      <strong className="font-medium text-foreground">Estimates describe a sample, not one state.</strong>{" "}
      An effect measured across all RGGI or RPS states is shown on each state&apos;s page as the
      same figure. It is not that state&apos;s own effect.
    </>,
    <>
      <strong className="font-medium text-foreground">Causation is rarely established.</strong>{" "}
      Only {d.policiesByTier.A} of {d.policyCount} policies have a tier A estimate, because that is
      all the peer-reviewed literature supports. The rest depend on a descriptive association or a
      plausible mechanism, or have no quantified effect at all. Several policies overlap, for example
      most RGGI states also have an RPS, and RGGI began during the 2008–09 recession and the
      shale-gas boom.
    </>,
    <>
      <strong className="font-medium text-foreground">Ranges are not always intervals.</strong>{" "}
      The low and high values on published estimates are often a range across the specifications
      a study reports, not a confidence interval. Only event-study rows are labelled &ldquo;95%
      interval&rdquo;.
    </>,
    <>
      <strong className="font-medium text-foreground">Leakage and spillovers.</strong> One study
      of RGGI (Yan 2021) finds emissions rose in neighbouring states. Estimates here are for the
      regulated region and are not net of that.
    </>,
    <>
      <strong className="font-medium text-foreground">Projections are not measurements.</strong>{" "}
      The Inflation Reduction Act figure is a modelled 2030 projection for the law as passed in
      2022, and later changes to the law probably make it an overstatement.
    </>,
    <>
      <strong className="font-medium text-foreground">The catalog is curated by hand.</strong> It
      holds {d.policyCount} policies, not every law or rule that touches emissions, and a missing
      policy is not evidence of no policy.
    </>,
    <>
      <strong className="font-medium text-foreground">Per-GDP and population caveats.</strong>{" "}
      Per-GDP uses current dollars from 1997 only, and pre-2000 population is interpolated.
    </>,
  ];
  return (
    <>
      <H2 id="limitations">Limitations</H2>
      <ul className="mt-2 list-disc space-y-2 pl-5 text-zinc-700 dark:text-zinc-300">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </>
  );
}

function PolicySources({ d }: { d: MethodologyData }) {
  return (
    <>
      <H2 id="sources">Policy and research sources</H2>
      <p className="mt-2">
        Dates, legal text and status come from these primary and institutional sources, and the effect estimates from the journals and working-paper series listed. Each policy
        page lists the specific documents it cites, and the research behind each effect estimate
        with its DOI.
      </p>
      <ul className="mt-3 space-y-2 text-sm">
        {d.policySources.map((s) => (
          <li key={s.name} className="leading-snug">
            {s.url ? (
              <ExtLink href={s.url}>
                <span className="font-medium">{s.name}</span>
              </ExtLink>
            ) : (
              <span className="font-medium">{s.name}</span>
            )}
            {s.publisher && <span className="text-zinc-500">, {s.publisher}</span>}
            {s.description && (
              <span className="text-zinc-600 dark:text-zinc-400"> — {s.description}</span>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

async function MethodologyBody() {
  const d = await getMethodologyData();
  return (
    <div className="text-sm leading-6 text-zinc-700 dark:text-zinc-300 [&_h3]:text-foreground">
      <Metrics d={d} />
      <Normalization d={d} />
      <Tiers d={d} />
      <ImpactScore d={d} />
      <Confidence />
      <EventStudy d={d} />
      <Applicability />
      <Limitations d={d} />
      <PolicySources d={d} />
    </div>
  );
}

export default function MethodologyPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
      <header>
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Methodology</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">How this site works</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          What is measured, how policies are graded, how this site&apos;s own estimates are made,
          and where the data runs out. See it applied on the{" "}
          <Link href="/metrics/co2" className="underline underline-offset-2">
            emissions rankings
          </Link>{" "}
          and the{" "}
          <Link href="/policies" className="underline underline-offset-2">
            policy catalog
          </Link>
          .
        </p>
      </header>

      <nav aria-label="On this page" className="mt-5 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
        <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {TOC.map((t) => (
            <li key={t.id}>
              <a href={`#${t.id}`} className="underline-offset-2 hover:underline">
                {t.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <Suspense fallback={<MethodologySkeleton />}>
        <MethodologyBody />
      </Suspense>
    </main>
  );
}

function MethodologySkeleton() {
  return (
    <div className="mt-10 animate-pulse space-y-4" aria-busy="true" aria-label="Loading methodology">
      <div className="h-6 w-1/3 rounded bg-zinc-100 dark:bg-zinc-900" />
      <div className="h-32 rounded-lg bg-zinc-100 dark:bg-zinc-900" />
      <div className="h-32 rounded-lg bg-zinc-100 dark:bg-zinc-900" />
    </div>
  );
}
